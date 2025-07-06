# Soccer Team Manager

A lightweight web application for managing a kid's soccer team summer tournament schedule and roster.

## Features

- **Admin Features:**
  - Add and manage tournament games
  - View complete team roster
  - See signup status for all games

- **Parent Features:**
  - View tournament schedule
  - Sign up for games
  - Remove game signups
  - See who else has signed up

## Getting Started

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the server:
   ```bash
   npm start
   ```

3. Open your browser to `http://localhost:3000`

## Login Information

- **Admin Account:**
  - Username: `admin`
  - Password: `admin123`

- **Player Login (Default Credentials):**
  - Username: Player's first name (e.g., "John")
  - Password: Player's first name + "_" + Parent's first name (e.g., "John_Mike")
  - Display name shows player's actual first name

## Deployment

This app is ready for deployment to Railway, Render, or similar Node.js hosting services.

### Environment Variables for Production

Set these in your hosting service:
- `JWT_SECRET`: A secure random string for JWT tokens
- `PORT`: Port number (automatically set by most hosting services)

## Technology Stack

- **Backend:** Node.js, Express, SQLite
- **Frontend:** HTML, CSS, JavaScript
- **Authentication:** JWT tokens
- **Database:** SQLite with automatic table creation

## API Endpoints

- `POST /api/login` - User authentication
- `POST /api/register` - Parent registration
- `GET /api/games` - Get all games
- `POST /api/games` - Add new game (admin only)
- `GET /api/games/:id/signups` - Get signups for a game
- `POST /api/games/:id/signup` - Sign up for a game
- `DELETE /api/games/:id/signup` - Remove signup
- `GET /api/roster` - Get team roster (admin only)

## Development

For development with auto-restart:
```bash
npm run dev
```