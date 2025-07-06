const express = require('express');
const sqlite3 = require('sqlite3').verbose();
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

const db = new sqlite3.Database('./soccer_team.db');

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

  const adminPassword = bcrypt.hashSync('admin123', 10);
  db.run(`INSERT OR IGNORE INTO users (username, password, role) VALUES (?, ?, ?)`, 
    ['admin', adminPassword, 'admin']);
});

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

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  
  db.get('SELECT * FROM users WHERE username = ?', [username], (err, user) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    
    if (!user) {
      // Try default credentials: look for user by kid's first name
      db.get('SELECT * FROM users WHERE kid_name LIKE ? AND role = "parent"', [`${username}%`], (err, defaultUser) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        if (!defaultUser) return res.status(401).json({ error: 'Invalid credentials' });
        
        // Check if password matches default format: kidFirstName_parentFirstName
        const kidFirstName = defaultUser.kid_name.split(' ')[0];
        const parentFirstName = defaultUser.parent_name.split(' ')[0];
        const expectedPassword = `${kidFirstName}_${parentFirstName}`;
        
        if (password === expectedPassword) {
          const token = jwt.sign(
            { id: defaultUser.id, username: defaultUser.username, role: defaultUser.role, kid_name: defaultUser.kid_name },
            JWT_SECRET,
            { expiresIn: '24h' }
          );
          res.json({ token, user: { id: defaultUser.id, username: defaultUser.username, role: defaultUser.role, kid_name: defaultUser.kid_name } });
        } else {
          res.status(401).json({ error: 'Invalid credentials' });
        }
      });
      return;
    }

    if (bcrypt.compareSync(password, user.password)) {
      const token = jwt.sign(
        { id: user.id, username: user.username, role: user.role },
        JWT_SECRET,
        { expiresIn: '24h' }
      );
      res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
    } else {
      res.status(401).json({ error: 'Invalid credentials' });
    }
  });
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

app.get('/api/games', authenticateToken, (req, res) => {
  db.all('SELECT * FROM games ORDER BY date, time', (err, games) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json(games);
  });
});

app.post('/api/games', authenticateToken, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const { opponent, date, time, location } = req.body;
  
  db.run(
    'INSERT INTO games (opponent, date, time, location) VALUES (?, ?, ?, ?)',
    [opponent, date, time, location],
    function(err) {
      if (err) return res.status(500).json({ error: 'Database error' });
      res.json({ id: this.lastID, opponent, date, time, location });
    }
  );
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