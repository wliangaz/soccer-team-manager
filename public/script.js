let currentUser = null;
let currentTab = 'games';

document.addEventListener('DOMContentLoaded', function() {
    const token = localStorage.getItem('token');
    if (token) {
        try {
            const payload = JSON.parse(atob(token.split('.')[1]));
            if (payload.exp > Date.now() / 1000) {
                currentUser = payload;
                showMainScreen();
                return;
            }
        } catch (e) {
            localStorage.removeItem('token');
        }
    }
    showLoginScreen();
});

function showLogin() {
    document.getElementById('login-form').classList.remove('hidden');
    document.getElementById('register-form').classList.add('hidden');
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-btn')[0].classList.add('active');
}


function showLoginScreen() {
    document.getElementById('login-screen').classList.remove('hidden');
    document.getElementById('main-screen').classList.add('hidden');
}

function showMainScreen() {
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('main-screen').classList.remove('hidden');
    
    let displayName = currentUser.username;
    if (currentUser.role === 'admin') {
        displayName = 'Admin';
    } else if (currentUser.kid_name) {
        displayName = currentUser.kid_name.split(' ')[0];
    }
    
    document.getElementById('welcome-text').textContent = `Welcome, ${displayName}!`;
    
    if (currentUser.role !== 'admin') {
        document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'none');
    }
    
    loadGames();
}

function showError(message) {
    const errorDiv = document.getElementById('error-message');
    errorDiv.textContent = message;
    errorDiv.classList.remove('hidden');
    setTimeout(() => errorDiv.classList.add('hidden'), 5000);
}

async function login(event) {
    event.preventDefault();
    
    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;
    
    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, password })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            localStorage.setItem('token', data.token);
            currentUser = data.user;
            showMainScreen();
        } else {
            showError(data.error);
        }
    } catch (error) {
        showError('Login failed. Please try again.');
    }
}


function logout() {
    localStorage.removeItem('token');
    currentUser = null;
    showLoginScreen();
}

function showTab(tabName) {
    document.querySelectorAll('.tab-content').forEach(tab => tab.classList.add('hidden'));
    document.getElementById(tabName + '-tab').classList.remove('hidden');
    
    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
    event.target.classList.add('active');
    
    currentTab = tabName;
    
    if (tabName === 'roster') {
        loadRoster();
    }
}

async function loadGames() {
    try {
        const response = await fetch('/api/games', {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });
        
        const games = await response.json();
        displayGames(games);
    } catch (error) {
        console.error('Error loading games:', error);
    }
}

async function displayGames(games) {
    const gamesList = document.getElementById('games-list');
    gamesList.innerHTML = '';
    
    if (games.length === 0) {
        gamesList.innerHTML = '<p>No games scheduled yet.</p>';
        return;
    }
    
    for (const game of games) {
        const signups = await loadGameSignups(game.id);
        const isSignedUp = signups.some(signup => signup.parent_name === currentUser.username);
        
        const gameCard = document.createElement('div');
        gameCard.className = 'game-card';
        gameCard.innerHTML = `
            <div class="game-header">
                <div class="game-title">vs ${game.opponent}</div>
                <div class="game-date">${formatDate(game.date)}</div>
            </div>
            <div class="game-details">
                <div class="game-detail">
                    <strong>🕒 Time:</strong> ${formatGameTime(game.time)} PST
                </div>
                <div class="game-detail">
                    <strong>📍 Location:</strong> ${game.location}
                </div>
            </div>
            <div class="signup-section">
                ${currentUser.role === 'parent' ? `
                    <button class="signup-button ${isSignedUp ? 'signed-up' : ''}" 
                            onclick="toggleSignup(${game.id}, ${isSignedUp})">
                        ${isSignedUp ? 'Remove Signup' : 'Sign Up'}
                    </button>
                ` : ''}
                <div class="signup-count">${signups.length} player${signups.length !== 1 ? 's' : ''} signed up</div>
                <div class="signups-list">
                    ${signups.map(signup => `
                        <div class="signup-item">
                            <div>
                                <strong>${signup.kid_name}</strong> (${signup.parent_name})
                            </div>
                            <small>${formatDateTime(signup.signed_up_at)}</small>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
        
        gamesList.appendChild(gameCard);
    }
}

async function loadGameSignups(gameId) {
    try {
        const response = await fetch(`/api/games/${gameId}/signups`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });
        return await response.json();
    } catch (error) {
        console.error('Error loading signups:', error);
        return [];
    }
}

async function toggleSignup(gameId, isSignedUp) {
    try {
        const method = isSignedUp ? 'DELETE' : 'POST';
        const response = await fetch(`/api/games/${gameId}/signup`, {
            method,
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });
        
        if (response.ok) {
            loadGames();
        }
    } catch (error) {
        console.error('Error toggling signup:', error);
    }
}

async function addGame(event) {
    event.preventDefault();
    
    const opponent = document.getElementById('opponent').value;
    const date = document.getElementById('game-date').value;
    const time = document.getElementById('game-time').value;
    const location = document.getElementById('location').value;
    
    try {
        const response = await fetch('/api/games', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: JSON.stringify({ opponent, date, time, location })
        });
        
        if (response.ok) {
            event.target.reset();
            showTab('games');
            loadGames();
        }
    } catch (error) {
        console.error('Error adding game:', error);
    }
}

async function loadRoster() {
    try {
        const response = await fetch('/api/roster', {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });
        
        const roster = await response.json();
        displayRoster(roster);
    } catch (error) {
        console.error('Error loading roster:', error);
    }
}

function displayRoster(roster) {
    const rosterList = document.getElementById('roster-list');
    rosterList.innerHTML = '';
    
    if (roster.length === 0) {
        rosterList.innerHTML = '<p>No players registered yet.</p>';
        return;
    }
    
    roster.forEach(player => {
        const rosterItem = document.createElement('div');
        rosterItem.className = 'roster-item';
        rosterItem.innerHTML = `
            <div class="roster-info">
                <div class="kid-name">${player.kid_name}</div>
                <div class="parent-name">Parent: ${player.parent_name}</div>
            </div>
            <div class="roster-actions">
                <div class="roster-username">@${player.username}</div>
                ${currentUser.role === 'admin' ? `
                    <button class="delete-btn" onclick="deletePlayer(${player.id}, '${player.kid_name}')">
                        Delete
                    </button>
                ` : ''}
            </div>
        `;
        
        rosterList.appendChild(rosterItem);
    });
}

function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        timeZone: 'America/Los_Angeles'
    });
}

function formatGameTime(timeString) {
    const [hours, minutes] = timeString.split(':');
    const date = new Date();
    date.setHours(parseInt(hours), parseInt(minutes), 0, 0);
    return date.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'America/Los_Angeles'
    });
}

function formatDateTime(dateTimeString) {
    const date = new Date(dateTimeString);
    return date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'America/Los_Angeles'
    });
}

async function addPlayer(event) {
    event.preventDefault();
    
    const username = document.getElementById('player-username').value || generateUsername();
    const parentName = document.getElementById('player-parent-name').value;
    const kidName = document.getElementById('player-kid-name').value;
    
    try {
        const response = await fetch('/api/roster/add-player', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: JSON.stringify({ username, parentName, kidName })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            event.target.reset();
            showError('Player added successfully!');
            if (currentTab === 'roster') {
                loadRoster();
            }
        } else {
            showError(data.error || 'Failed to add player');
        }
    } catch (error) {
        showError('Error adding player. Please try again.');
    }
}

async function uploadCSV(event) {
    event.preventDefault();
    
    const fileInput = document.getElementById('csv-file');
    const file = fileInput.files[0];
    
    if (!file) {
        showError('Please select a CSV file');
        return;
    }
    
    const formData = new FormData();
    formData.append('csvFile', file);
    
    const statusDiv = document.getElementById('csv-upload-status');
    statusDiv.innerHTML = 'Uploading...';
    
    try {
        const response = await fetch('/api/roster/upload-csv', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: formData
        });
        
        const data = await response.json();
        
        if (response.ok) {
            statusDiv.innerHTML = `✅ Successfully added ${data.addedCount} players`;
            event.target.reset();
            if (currentTab === 'roster') {
                loadRoster();
            }
        } else {
            statusDiv.innerHTML = `❌ Error: ${data.error}`;
        }
    } catch (error) {
        statusDiv.innerHTML = '❌ Upload failed. Please try again.';
    }
}

function generateUsername() {
    return 'player_' + Math.random().toString(36).substr(2, 9);
}

async function deletePlayer(playerId, kidName) {
    if (!confirm(`Are you sure you want to delete ${kidName} from the roster? This action cannot be undone.`)) {
        return;
    }
    
    try {
        const response = await fetch(`/api/roster/delete-player/${playerId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showError('Player deleted successfully!');
            loadRoster();
        } else {
            showError(data.error || 'Failed to delete player');
        }
    } catch (error) {
        showError('Error deleting player. Please try again.');
    }
}


function showAdminAddGame() {
    document.getElementById('admin-add-game-modal').classList.remove('hidden');
}

function showAdminRoster() {
    document.getElementById('admin-roster-modal').classList.remove('hidden');
    loadAdminRosterCount();
}

function hideAdminModals() {
    document.getElementById('admin-add-game-modal').classList.add('hidden');
    document.getElementById('admin-roster-modal').classList.add('hidden');
}

async function adminAddGame(event) {
    event.preventDefault();
    
    const opponent = document.getElementById('admin-opponent').value;
    const date = document.getElementById('admin-game-date').value;
    const time = document.getElementById('admin-game-time').value;
    const location = document.getElementById('admin-location').value;
    
    try {
        const response = await fetch('/api/games', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: JSON.stringify({ opponent, date, time, location })
        });
        
        if (response.ok) {
            event.target.reset();
            hideAdminModals();
            showError('Game added successfully!');
        } else {
            const data = await response.json();
            showError(data.error || 'Failed to add game');
        }
    } catch (error) {
        showError('Error adding game. Please try again.');
    }
}

async function loadAdminRosterCount() {
    try {
        const response = await fetch('/api/roster', {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });
        
        const roster = await response.json();
        document.getElementById('admin-roster-count').textContent = 
            `Total registered players: ${roster.length}`;
    } catch (error) {
        console.error('Error loading roster count:', error);
    }
}

async function adminAddPlayer(event) {
    event.preventDefault();
    
    const playerName = document.getElementById('admin-player-name').value;
    const parentName = document.getElementById('admin-parent-name').value;
    const username = generateUsername();
    
    try {
        const response = await fetch('/api/roster/add-player', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: JSON.stringify({ username, parentName, kidName: playerName })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            event.target.reset();
            showError('Player added successfully!');
            loadAdminRosterCount();
        } else {
            showError(data.error || 'Failed to add player');
        }
    } catch (error) {
        showError('Error adding player. Please try again.');
    }
}

async function adminUploadCSV(event) {
    event.preventDefault();
    
    const fileInput = document.getElementById('admin-csv-file');
    const file = fileInput.files[0];
    
    if (!file) {
        showError('Please select a CSV file');
        return;
    }
    
    const formData = new FormData();
    formData.append('csvFile', file);
    
    const statusDiv = document.getElementById('admin-csv-status');
    statusDiv.innerHTML = 'Uploading...';
    
    try {
        const response = await fetch('/api/roster/upload-csv', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: formData
        });
        
        const data = await response.json();
        
        if (response.ok) {
            statusDiv.innerHTML = `✅ Successfully added ${data.addedCount} players`;
            event.target.reset();
            loadAdminRosterCount();
        } else {
            statusDiv.innerHTML = `❌ Error: ${data.error}`;
        }
    } catch (error) {
        statusDiv.innerHTML = '❌ Upload failed. Please try again.';
    }
}