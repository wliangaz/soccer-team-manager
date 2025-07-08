const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const multer = require('multer');
const csv = require('csv-parser');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  console.error('JWT_SECRET environment variable is required');
  process.exit(1);
}

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({ dest: 'uploads/' });

// Database configuration - PostgreSQL for production, SQLite for development
const DATABASE_URL = process.env.DATABASE_URL;
let db;
let isPostgres = false;

if (DATABASE_URL) {
  // Production: Use PostgreSQL
  console.log('Using PostgreSQL database');
  isPostgres = true;
  db = new Pool({
    connectionString: DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });
} else {
  // Development: Use SQLite
  try {
    db = new sqlite3.Database('./soccer_team.db');
    console.log('Using SQLite database: ./soccer_team.db');
  } catch (err) {
    console.log('SQLite failed, using in-memory database:', err.message);
    db = new sqlite3.Database(':memory:');
  }
}

// Database initialization function
async function initializeDatabase() {
  const adminPassword = bcrypt.hashSync('admin123', 10);
  
  if (isPostgres) {
    // PostgreSQL schema
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          username VARCHAR(255) UNIQUE NOT NULL,
          password VARCHAR(255) NOT NULL,
          role VARCHAR(50) NOT NULL,
          parent_name VARCHAR(255),
          kid_name VARCHAR(255),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS games (
          id SERIAL PRIMARY KEY,
          opponent VARCHAR(255) NOT NULL,
          date VARCHAR(10) NOT NULL,
          time VARCHAR(10) NOT NULL,
          location VARCHAR(255) NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS signups (
          id SERIAL PRIMARY KEY,
          game_id INTEGER NOT NULL,
          user_id INTEGER NOT NULL,
          signed_up_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (game_id) REFERENCES games (id),
          FOREIGN KEY (user_id) REFERENCES users (id),
          UNIQUE(game_id, user_id)
        )
      `);

      // Create admin user
      await db.query(`
        INSERT INTO users (username, password, role) 
        VALUES ($1, $2, $3) 
        ON CONFLICT (username) DO NOTHING
      `, ['admin', adminPassword, 'admin']);

      console.log('PostgreSQL database initialized successfully');
    } catch (err) {
      console.error('Error initializing PostgreSQL:', err);
    }
  } else {
    // SQLite schema
    db.serialize(() => {
      db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT NOT NULL,
        parent_name TEXT,
        kid_name TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS games (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        opponent TEXT NOT NULL,
        date TEXT NOT NULL,
        time TEXT NOT NULL,
        location TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS signups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        game_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        signed_up_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (game_id) REFERENCES games (id),
        FOREIGN KEY (user_id) REFERENCES users (id),
        UNIQUE(game_id, user_id)
      )`);

      console.log('Creating admin user with password hash:', adminPassword);
      db.run(`INSERT OR IGNORE INTO users (username, password, role) VALUES (?, ?, ?)`, 
        ['admin', adminPassword, 'admin'], function(err) {
          if (err) {
            console.error('Error creating admin user:', err);
          } else {
            console.log('Admin user created/verified successfully');
          }
        });
    });
  }
}

// Initialize database
initializeDatabase();

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.sendStatus(401);
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
};

// Database helper functions
const dbQuery = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    if (isPostgres) {
      db.query(sql, params, (err, result) => {
        if (err) reject(err);
        else resolve(result.rows);
      });
    } else {
      db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    }
  });
};

const dbGet = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    if (isPostgres) {
      db.query(sql, params, (err, result) => {
        if (err) reject(err);
        else resolve(result.rows[0]);
      });
    } else {
      db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    }
  });
};

const dbRun = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    if (isPostgres) {
      db.query(sql, params, (err, result) => {
        if (err) reject(err);
        else resolve({ insertId: result.insertId, changes: result.rowCount });
      });
    } else {
      db.run(sql, params, function(err) {
        if (err) reject(err);
        else resolve({ insertId: this.lastID, changes: this.changes });
      });
    }
  });
};

// Health check endpoint to verify server is running
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    database: db ? 'connected' : 'disconnected',
    dbType: isPostgres ? 'PostgreSQL' : 'SQLite'
  });
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  
  console.log('Login attempt:', { username, passwordProvided: !!password });
  
  try {
    const user = await dbGet('SELECT * FROM users WHERE username = ' + (isPostgres ? '$1' : '?'), [username]);
    
    if (!user) {
      console.log('User not found, trying default credentials for:', username);
      // Try default credentials: look for user by kid's first name
      const defaultUser = await dbGet('SELECT * FROM users WHERE kid_name LIKE ' + (isPostgres ? '$1' : '?') + ' AND role = ' + (isPostgres ? '$2' : '?'), [`${username}%`, 'parent']);
      
      if (!defaultUser) {
        console.log('No default user found for:', username);
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      
      // Check if password matches default format: kidFirstName_parentFirstName
      const kidFirstName = defaultUser.kid_name.split(' ')[0];
      const parentFirstName = defaultUser.parent_name.split(' ')[0];
      const expectedPassword = `${kidFirstName}_${parentFirstName}`;
      
      console.log('Checking default password for:', username, 'Expected:', expectedPassword);
      
      if (password === expectedPassword) {
        const token = jwt.sign(
          { id: defaultUser.id, username: defaultUser.username, role: defaultUser.role, kid_name: defaultUser.kid_name },
          JWT_SECRET,
          { expiresIn: '24h' }
        );
        console.log('Default user login successful for:', username);
        return res.json({ token, user: { id: defaultUser.id, username: defaultUser.username, role: defaultUser.role, kid_name: defaultUser.kid_name } });
      } else {
        console.log('Default password mismatch for:', username);
        return res.status(401).json({ error: 'Invalid credentials' });
      }
    }

    console.log('Found user:', user.username, 'Role:', user.role);
    
    if (bcrypt.compareSync(password, user.password)) {
      console.log('Password verification successful for:', user.username);
      const token = jwt.sign(
        { id: user.id, username: user.username, role: user.role },
        JWT_SECRET,
        { expiresIn: '24h' }
      );
      console.log('Login successful for:', user.username);
      res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
    } else {
      console.log('Password verification failed for:', user.username);
      res.status(401).json({ error: 'Invalid credentials' });
    }
  } catch (err) {
    console.error('Database error during login:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/api/register', (req, res) => {
  const { username, password, parentName, kidName } = req.body;
  
  if (!username || !password || !parentName || !kidName) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  const hashedPassword = bcrypt.hashSync(password, 10);
  
  db.run(
    'INSERT INTO users (username, password, role, parent_name, kid_name) VALUES (?, ?, ?, ?, ?)',
    [username, hashedPassword, 'parent', parentName, kidName],
    function(err) {
      if (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
          return res.status(400).json({ error: 'Username already exists' });
        }
        return res.status(500).json({ error: 'Database error' });
      }
      res.json({ message: 'User registered successfully' });
    }
  );
});

app.get('/api/games', authenticateToken, async (req, res) => {
  try {
    const games = await dbQuery('SELECT * FROM games ORDER BY date, time');
    res.json(games);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/api/games', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const { opponent, date, time, location } = req.body;
  
  try {
    const result = await dbRun(
      'INSERT INTO games (opponent, date, time, location) VALUES (' + 
      (isPostgres ? '$1, $2, $3, $4' : '?, ?, ?, ?') + ')',
      [opponent, date, time, location]
    );
    res.json({ id: result.insertId, opponent, date, time, location });
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

app.get('/api/games/:id/signups', authenticateToken, (req, res) => {
  const gameId = req.params.id;
  
  db.all(`
    SELECT s.id, s.signed_up_at, u.parent_name, u.kid_name
    FROM signups s
    JOIN users u ON s.user_id = u.id
    WHERE s.game_id = ?
    ORDER BY s.signed_up_at
  `, [gameId], (err, signups) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json(signups);
  });
});

app.post('/api/games/:id/signup', authenticateToken, (req, res) => {
  const gameId = req.params.id;
  const userId = req.user.id;
  
  db.run(
    'INSERT INTO signups (game_id, user_id) VALUES (?, ?)',
    [gameId, userId],
    function(err) {
      if (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
          return res.status(400).json({ error: 'Already signed up for this game' });
        }
        return res.status(500).json({ error: 'Database error' });
      }
      res.json({ message: 'Signed up successfully' });
    }
  );
});

app.delete('/api/games/:id/signup', authenticateToken, (req, res) => {
  const gameId = req.params.id;
  const userId = req.user.id;
  
  db.run(
    'DELETE FROM signups WHERE game_id = ? AND user_id = ?',
    [gameId, userId],
    function(err) {
      if (err) return res.status(500).json({ error: 'Database error' });
      res.json({ message: 'Signup removed successfully' });
    }
  );
});

app.delete('/api/games/:id', authenticateToken, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const gameId = req.params.id;
  
  // First delete all signups for this game
  db.run('DELETE FROM signups WHERE game_id = ?', [gameId], function(err) {
    if (err) {
      return res.status(500).json({ error: 'Error deleting game signups' });
    }
    
    // Then delete the game itself
    db.run('DELETE FROM games WHERE id = ?', [gameId], function(err) {
      if (err) {
        return res.status(500).json({ error: 'Error deleting game' });
      }
      
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Game not found' });
      }
      
      res.json({ message: 'Game deleted successfully' });
    });
  });
});

app.get('/api/roster', authenticateToken, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  db.all('SELECT id, username, parent_name, kid_name FROM users WHERE role = "parent"', (err, users) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json(users);
  });
});

app.post('/api/roster/add-player', authenticateToken, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const { username, parentName, kidName } = req.body;
  
  if (!parentName || !kidName) {
    return res.status(400).json({ error: 'Parent name and kid name are required' });
  }

  const defaultPassword = bcrypt.hashSync('defaultpass123', 10);
  
  db.run(
    'INSERT INTO users (username, password, role, parent_name, kid_name) VALUES (?, ?, ?, ?, ?)',
    [username, defaultPassword, 'parent', parentName, kidName],
    function(err) {
      if (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
          return res.status(400).json({ error: 'Username already exists' });
        }
        return res.status(500).json({ error: 'Database error' });
      }
      res.json({ message: 'Player added successfully', id: this.lastID });
    }
  );
});

app.post('/api/roster/upload-csv', authenticateToken, upload.single('csvFile'), (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const fs = require('fs');
  const results = [];
  let addedCount = 0;
  let errorCount = 0;

  fs.createReadStream(req.file.path)
    .pipe(csv())
    .on('data', (data) => {
      const parentName = data['parent name'] || data.parent_name || data['parent_name'] || data.Parent || data.parent;
      const kidName = data.player || data.kid_name || data['kid_name'] || data.Kid || data.kid || data.child;
      const username = data.username || data.Username || `player_${Math.random().toString(36).substr(2, 9)}`;
      
      if (parentName && kidName) {
        results.push({ username, parentName, kidName });
      }
    })
    .on('end', () => {
      const defaultPassword = bcrypt.hashSync('defaultpass123', 10);
      
      let processed = 0;
      results.forEach((player) => {
        db.run(
          'INSERT INTO users (username, password, role, parent_name, kid_name) VALUES (?, ?, ?, ?, ?)',
          [player.username, defaultPassword, 'parent', player.parentName, player.kidName],
          function(err) {
            processed++;
            if (err) {
              errorCount++;
            } else {
              addedCount++;
            }
            
            if (processed === results.length) {
              fs.unlinkSync(req.file.path);
              res.json({ 
                message: 'CSV processing completed',
                addedCount,
                errorCount,
                totalProcessed: results.length
              });
            }
          }
        );
      });
      
      if (results.length === 0) {
        fs.unlinkSync(req.file.path);
        res.status(400).json({ error: 'No valid player data found in CSV' });
      }
    })
    .on('error', (err) => {
      fs.unlinkSync(req.file.path);
      res.status(500).json({ error: 'Error processing CSV file' });
    });
});

app.delete('/api/roster/delete-player/:id', authenticateToken, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const playerId = req.params.id;
  
  if (!playerId) {
    return res.status(400).json({ error: 'Player ID is required' });
  }

  db.run('DELETE FROM signups WHERE user_id = ?', [playerId], function(err) {
    if (err) {
      return res.status(500).json({ error: 'Error deleting player signups' });
    }
    
    db.run('DELETE FROM users WHERE id = ? AND role = "parent"', [playerId], function(err) {
      if (err) {
        return res.status(500).json({ error: 'Error deleting player' });
      }
      
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Player not found' });
      }
      
      res.json({ message: 'Player deleted successfully' });
    });
  });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});