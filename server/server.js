require('dotenv').config();
const express = require("express");
const path = require("path");
const bodyParser = require("body-parser");
const session = require("express-session");
const bcrypt = require("bcrypt");
const config = require("./config.js");
const movieModel = require("./movie-model.js");
const userModel = require("./user-model.js");

const app = express();

// Parse urlencoded bodies
app.use(bodyParser.json());

// Session middleware
app.use(session({
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false } // Set to true if using HTTPS
}));

// Serve static content in directory 'files'
app.use(express.static(path.join(__dirname, "files")));

app.post("/login", (req, res) => {
  const { username, password } = req.body;
  const user = userModel[username];
  if (user && bcrypt.compareSync(password, user.password)) {
    req.session.user = {
      username,
      firstName: user.firstName,
      lastName: user.lastName,
      loginTime: new Date().toISOString(),
    };

    req.session.save((err) => {
      if (err) {
        console.error("Session-Speicherfehler:", err);
        return res.sendStatus(500);
      }
    res.send(req.session.user);
    });
  } else {
    res.sendStatus(401);
  }
});

// Task 1.3: Implement the GET `/logout` endpoint and requireLogin
// protection. Implement logout by destroying the session 
// with error handling. Protect all endpoints that need 
// authentication with `requireLogin`.

function requireLogin(req, res, next) {
  if (req.session && req.session.user) {
    next();
  } else {
    res.sendStatus(401);
  }
}

app.get('/logout', requireLogin, (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Fehler beim Logout:', err);
      res.sendStatus(500);
    } else {
      res.sendStatus(200);
    }
  });
});

app.get("/session", requireLogin, (req, res) => {
  if (req.session.user) {
    res.send(req.session.user);
  } else {
    res.status(401).json(null);
  }
});

app.get("/movies", requireLogin, (req, res) => {
  const username = req.session.user.username;
  let movies = Object.values(movieModel.getUserMovies(username));
  const queriedGenre = req.query.genre;
  if (queriedGenre) {
    movies = movies.filter((movie) => movie.Genres.indexOf(queriedGenre) >= 0);
  }
  res.send(movies);
});

// Configure a 'get' endpoint for a specific movie
app.get("/movies/:imdbID", requireLogin, (req, res) => {
  const username = req.session.user.username;
  const id = req.params.imdbID;
  const movie = movieModel.getUserMovie(username, id);

  if (movie) {
    res.send(movie);
  } else {
    res.sendStatus(404);
  }
});

// Configure a 'put' endpoint for a specific movie to update or insert a movie
app.put("/movies/:imdbID", requireLogin, (req, res) => {
  const username = req.session.user.username;
  const imdbID = req.params.imdbID;
  const exists = movieModel.getUserMovie(username, imdbID) !== undefined;

  if (!exists) {
    // Task 2.3: Fetch the movie data from OmdbAPI, follow the pattern used further down 
    // in the GET /search endpoint. Implement conversion of the OmdbAPI response to the 
    // movie format used in the frontend. Make sure to handle errors and timeouts properly.

    const url = `https://www.omdbapi.com/?i=${imdbID}&apikey=${config.omdbApiKey}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);

    fetch(url, { signal: controller.signal })
      .then(apiRes => {
        if (!apiRes.ok) {
          throw new Error(`HTTP Fehler: ${apiRes.status}`);
        }
        return apiRes.json();
      })
      .then(movieData => {
        if (movieData.Response === 'True') {
     
          const internalMovieFormat = {
            Title: movieData.Title,
            Year: isNaN(parseInt(movieData.Year)) ? movieData.Year : parseInt(movieData.Year),
            imdbID: movieData.imdbID,
            Type: movieData.Type,
            Poster: movieData.Poster,
            Plot: movieData.Plot,
            Directors: movieData.Director ? movieData.Director.split(', ').map(d => d.trim()) : [],
            Writers: movieData.Writer ? movieData.Writer.split(', ').map(w => w.trim()) : [],
            Actors: movieData.Actors ? movieData.Actors.split(', ').map(a => a.trim()) : [],
            Genres: movieData.Genre ? movieData.Genre.split(', ').map(g => g.trim()) : []
          };

          movieModel.setUserMovie(username, imdbID, internalMovieFormat);

          res.sendStatus(201);

  } else {
    res.status(404).send("Film nicht auf OMDb gefunden.");
  }
})
.catch(err => {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') {
          console.error('OMDb API Timeout');
          res.sendStatus(504);
        } else {
          console.error('Fehler beim Abrufen der Filmdaten:', err);
          res.sendStatus(500);
        }
      });
  } else {
    movieModel.setUserMovie(username, imdbID, req.body);
    res.sendStatus(200);
  }
});

app.delete("/movies/:imdbID", requireLogin, (req, res) => {
  const username = req.session.user.username;
  const id = req.params.imdbID;
  if (movieModel.deleteUserMovie(username, id)) {
    res.sendStatus(200);
  } else {
    res.sendStatus(404);
  }
});

// Configure a 'get' endpoint for genres of all movies of the current user
app.get("/genres", requireLogin, (req, res) => {
  const username = req.session.user.username;
  const genres = movieModel.getGenres(username);
  genres.sort();
  res.send(genres);
});

/* Task 2.1. Add the GET /search endpoint: Query omdbapi.com and return
   a list of the results you obtain. Only include the properties 
   mentioned in the README when sending back the results to the client. */
app.get("/search", requireLogin, (req, res) => {

  const username = req.session.user.username;
  const query = req.query.query;
  if (!query) {
    return res.sendStatus(400);
  }

  const url = `https://www.omdbapi.com/?s=${encodeURIComponent(query)}&apikey=${config.omdbApiKey}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.omdbTimeoutMs);

  fetch(url, { signal: controller.signal })
    .then(apiRes => {
      clearTimeout(timeoutId);
      if (!apiRes.ok) {
        return res.sendStatus(apiRes.status);
      }
      return apiRes.json();
    })
      .then(response => {

        if (res.headersSent) return;

        if (response.Response === 'True') {
          const results = response.Search
            .filter(movie => !movieModel.hasUserMovie(username, movie.imdbID))
            .map(movie => ({
              Title: movie.Title,
              imdbID: movie.imdbID,
              Year: isNaN(movie.Year) ? null : parseInt(movie.Year)
            }));
          res.send(results);
        } else {
          res.send([]);
        }
    })
    .catch((err) => {
      clearTimeout(timeoutId);
      if (!res.headersSent) {
        if (err.name === 'AbortError') {
          console.error('OMDb API request timeout');
          res.sendStatus(504);
        } else {
      console.error('OMDb API error:', err);
      res.sendStatus(500);
        }
      }
    });
});

app.listen(config.port);

console.log(`Server now listening on http://localhost:${config.port}/`);