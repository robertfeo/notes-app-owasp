// Importiere notwendige Module
import mysql from "mysql2/promise";
import express from "express";
import session from "express-session";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import url from "url";
import path from "path";
import methodOverride from "method-override";

// Importiere benutzerdefinierte Funktionen aus database.js
import {
  getNotes,
  getUserNotes,
  createNote,
  updateNote,
  fetchNoteById,
  getUsers,
  validateUserCredentials,
  deleteNote,
  pool
} from "./database/database.js";

// Importiere readFile Funktion aus fs/promises Modul
import { readFile } from "fs/promises";

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Lade Umgebungsvariablen aus .env-Datei
dotenv.config();

// Erstelle eine Express-Anwendung
const app = express();

// Setze den Port, auf dem die Anwendung laufen soll
const PORT = process.env.WEBAPP_SERVICE_APP_PORT;

app.set("view engine", "ejs");

// Set up express-session

/* OWASP Top 10: A02:2021 – Cryptographic Failures
In der Verwendung von express-session wird ein schwaches Geheimnis 1234 verwendet. Dieses Geheimnis
 kann leicht erraten oder durch Brute-Force-Angriffe geknackt werden. Es wird empfohlen, 
 ein starkes, zufällig generiertes Geheimnis mit ausreichender Länge und Komplexität zu verwenden. */

 /* A05:2021 – Security Misconfiguration (Sicherheitsfehlkonfiguration)

 Das Cookie-Attribut secure ist auf false gesetzt. Dies kann dazu führen, dass die Anwendung 
 anfällig für Man-in-the-Middle-Angriffe wird, bei denen Angreifer unverschlüsselte Cookies 
 abfangen können. Es wird empfohlen, das secure-Attribut auf true zu setzen, wenn Ihre Anwendung 
 über HTTPS bereitgestellt wird */
app.use(
  session({
    secret: "1234",
    resave: false,
    saveUninitialized: true,
    cookie: {
      maxAge: 60000 * 60 * 24,
      sameSite: true,
      secure: false,
      httpOnly: true
    },
  })
);

// Set uses
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "public")));
app.use(methodOverride("_method"));

// Funktion zum Ausführen einer SQL-Datei mit der angegebenen MySQL-Verbindung
async function executeSQLFile(filePath, connection) {
  try {
    // Lese die SQL-Datei und teile die Anweisungen auf
    const sql = await readFile(filePath, "utf-8");
    const statements = sql
      .split(";")
      .map((statement) => statement.trim())
      .filter((statement) => statement.length);

    console.log("✅\tStarting to populate the database...");
    // Führe jede SQL-Anweisung aus
    for (const statement of statements) {
      await connection.query(statement);
    }

    console.log("✅\tPopulation finished succesfully");
  } catch (err) {
    console.error("❌\tError executing SQL file:", err);
  }
}

// Funktion zum Initialisieren der Datenbank
async function initializeDatabase() {
  try {
    // Stelle eine Verbindung zur MySQL-Datenbank her
    const connection = await pool.getConnection();
    console.log("✅\tConnected to database");

    // Führe die schema.sql-Datei aus
    await executeSQLFile("./database/schema.sql", connection);

    // Beende die Verbindung zur Datenbank
    connection.release();
  } catch (err) {
    console.error("❌\tError connecting to MySQL database:", err);
  }
}

// Initialisiere die Datenbank und starte den Server
initializeDatabase()
  .then(() => {
    app.listen(PORT, (error) => {
      if (!error) {
        console.log("✅\tServer is running and listening on port " + PORT);
      } else {
        console.log("❌\tError occurred, server can't start", error);
      }
    });
  })
  .catch((err) => {
    console.error("❌\tFailed to initialize database:", err);
  });

// Basic authentication middleware
const basicAuth = (req, res, next) => {
  if (req.session.userId) {
    next();
  } else {
    res.status(401).send("Access denied: Please log in");
  }
};

/* A07:2021 – Identification and Authentication Failures (Identifizierungs- und Authentifizierungsfehler)

Der Endpunkt /allnotes ist nicht ordnungsgemäß geschützt, und jeder, der die URL kennt, kann darauf zugreifen. 
Um dies zu beheben, muss die basicAuth-Middleware hinzugefügt werden, um sicherzustellen, dass nur authentifizierte 
Benutzer Zugriff auf den Endpunkt haben */
app.get("/allnotes", async (req, res) => {
  //  LÖSUNG
  /* // Check if user is logged in
  if (!req.session.userId) {
    res.redirect("/login");
    return;
  } */

  const notes = await getNotes();
  res.send(notes);
});

app.get("/", (req, res) => {
  const errors = [];
  res.render("homepage", { session: req.session, req: req, errors });
});

app.get("/users", async (req, res) => {
  const users = await getUsers();
  res.send(users);
});

// Login GET route handler
app.get("/login", (req, res) => {
  res.render("login", { userId: req.session.userId, error: null });
});

// Login POST route handler
app.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    // Check if the provided username and password are valid
    const user = await validateUserCredentials(username, password);

    /* const user = await weakAuthenticate(username,password); */

    if (user) {
      // Set the session data
      req.session.userId = user.user_id;
      req.session.username = user.username;
      req.session.password = user.password;

      const userData = JSON.stringify({ id: user.id, username: user.username, password: user.password });

      res.cookie("sessionId", req.sessionID, { httpOnly: false });
      res.cookie("userData", userData, { httpOnly: false });

      // Redirect to user's notes
      res.redirect("/notes");
    } else {
      // Authentication failed
      res.render("login", { error: "Authentication failed" });
    }
  } catch (error) {
    if (error.sqlMessage) {
      console.error("SQL error:", error);
      res.render("login", { error: error });
    } else {
      console.error("Non-SQL error:", error);
      res.render("login", { error: "An error occurred" });
    }
  }
});

// Notes route handler
app.get("/notes", async (req, res) => {
  // Check if user is logged in
  if (!req.session.userId) {
    res.redirect("/login");
    return;
  }

  try {
    // Fetch notes for the logged-in user
    const notes = await getUserNotes(req.session.userId);

    // Pass the notes and the username to the EJS template
    res.render("notes", {
      session: req.session,
      req: req,
      notes,
      username: req.session.username,
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("Error occurred while fetching notes");
  }
});

app.post("/notes", async (req, res) => {
  const title = req.body.title;
  const note = req.body.note;
  await createNote(req.session.userId, title, note);
  res.redirect("/notes");
});

app.get("/edit-note/:note_id", basicAuth, async (req, res) => {
  try {
    const noteId = req.params.note_id;
    const userId = req.session.userId;

    // Check if user is logged in
    if (!userId) {
      res.redirect("/login");
      return;
    }

    // Fetch the note with the given ID for the current user
    const note = await fetchNoteById(noteId, userId);

    if (note) {
      res.render("editnote", {
        note,
        userId: req.session.userId,
        username: req.session.username,
      });
    } else {
      // The note does not exist or does not belong to the user
      res.status(404).send("Note not found");
    }
  } catch (error) {
    console.error(error);
    res.status(500).send("Error occurred while fetching note");
  }
});

app.post("/edit-note/:note_id", basicAuth, async (req, res) => {
  // Check if user is logged in
  if (!req.session.userId) {
    res.redirect("/login");
    return;
  }

  try {
    const noteId = req.params.note_id;
    const title = req.body.title;
    const content = req.body.content;

    // Update the note in the database
    await updateNote(noteId, title, content);

    // Redirect to user's notes
    res.redirect("/notes");
  } catch (error) {
    console.error(error);
    res.status(500).send("Error occurred while updating note");
  }
});

app.post("/delete-note/:note_id", async (req, res) => {
  try {
    const noteId = req.params.note_id;

    // Delete the note with the given ID
    await deleteNote(noteId);

    // Redirect to user's notes
    res.redirect("/notes");
  } catch (error) {
    console.error(error);
    res.status(500).send("Error occurred while deleting note");
  }
});

// Logout route handler
app.get("/logout", (req, res) => {
  // Destroy the session
  req.session.destroy((err) => {
    if (err) {
      console.error(err);
      res.status(500).json({ message: "Error occurred during logout" });
    } else {
      res.redirect("/");
    }
  });
});
