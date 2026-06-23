const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize database
const db = new sqlite3.Database('./database.sqlite', (err) => {
    if (err) {
        console.error('Error opening database', err.message);
    } else {
        console.log('Connected to the SQLite database.');

        db.serialize(() => {
            // Create tables
            db.run(`CREATE TABLE IF NOT EXISTS people (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                firstName TEXT,
                lastName TEXT,
                birthYear INTEGER,
                deathYear INTEGER
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS relationships (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                person1Id INTEGER,
                person2Id INTEGER,
                type TEXT, -- 'parent_child', 'spouse'
                FOREIGN KEY (person1Id) REFERENCES people(id),
                FOREIGN KEY (person2Id) REFERENCES people(id)
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS suggestions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                data TEXT, -- JSON string of suggested person/relationship
                status TEXT DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
                createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS settings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                key TEXT UNIQUE,
                value TEXT
            )`);

            // Insert default settings
            const stmt = db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`);
            stmt.run('treeTitle', 'Our Family Tree');
            stmt.run('fontFamily', 'Arial, sans-serif');
            stmt.run('fontSize', '16px');
            stmt.run('fontColor', '#333333');
            stmt.run('lineColor', '#666666');
            stmt.run('parentChildLineStyle', 'solid');
            stmt.run('spouseLineStyle', 'dashed');
            stmt.finalize();
        });
    }
});

// Settings API
app.get('/api/settings', (req, res) => {
    db.all("SELECT key, value FROM settings", [], (err, rows) => {
        if (err) {
            res.status(500).json({"error": err.message});
            return;
        }
        const settings = {};
        rows.forEach(row => {
            settings[row.key] = row.value;
        });
        res.json(settings);
    });
});

app.post('/api/settings', (req, res) => {
    const { key, value } = req.body;
    db.run(`INSERT OR REPLACE INTO settings (id, key, value) VALUES ((SELECT id FROM settings WHERE key = ?), ?, ?)`,
        [key, key, value],
        function(err) {
            if (err) {
                res.status(500).json({"error": err.message});
                return;
            }
            res.json({"message": "success"});
        });
});

// People API
app.get('/api/people', (req, res) => {
    db.all("SELECT * FROM people", [], (err, rows) => {
        if (err) {
            res.status(500).json({"error": err.message});
            return;
        }
        res.json(rows);
    });
});

app.post('/api/people', (req, res) => {
    const { firstName, lastName, birthYear, deathYear } = req.body;
    db.run(`INSERT INTO people (firstName, lastName, birthYear, deathYear) VALUES (?, ?, ?, ?)`,
        [firstName, lastName, birthYear, deathYear],
        function(err) {
            if (err) {
                res.status(500).json({"error": err.message});
                return;
            }
            res.json({ id: this.lastID, firstName, lastName, birthYear, deathYear });
        });
});

app.put('/api/people/:id', (req, res) => {
    const { firstName, lastName, birthYear, deathYear } = req.body;
    db.run(`UPDATE people SET firstName = ?, lastName = ?, birthYear = ?, deathYear = ? WHERE id = ?`,
        [firstName, lastName, birthYear, deathYear, req.params.id],
        function(err) {
            if (err) {
                res.status(500).json({"error": err.message});
                return;
            }
            res.json({ message: "success" });
        });
});

app.delete('/api/people/:id', (req, res) => {
    db.run(`DELETE FROM people WHERE id = ?`, req.params.id, function(err) {
        if (err) {
            res.status(500).json({"error": err.message});
            return;
        }
        // Also delete related relationships
        db.run(`DELETE FROM relationships WHERE person1Id = ? OR person2Id = ?`, [req.params.id, req.params.id]);
        res.json({ message: "success" });
    });
});

// Relationships API
app.get('/api/relationships', (req, res) => {
    db.all("SELECT * FROM relationships", [], (err, rows) => {
        if (err) {
            res.status(500).json({"error": err.message});
            return;
        }
        res.json(rows);
    });
});

app.post('/api/relationships', (req, res) => {
    const { person1Id, person2Id, type } = req.body;
    // person1 is parent, person2 is child
    // OR person1 is spouse, person2 is spouse
    db.run(`INSERT INTO relationships (person1Id, person2Id, type) VALUES (?, ?, ?)`,
        [person1Id, person2Id, type],
        function(err) {
            if (err) {
                res.status(500).json({"error": err.message});
                return;
            }
            res.json({ id: this.lastID, person1Id, person2Id, type });
        });
});

app.delete('/api/relationships/:id', (req, res) => {
    db.run(`DELETE FROM relationships WHERE id = ?`, req.params.id, function(err) {
        if (err) {
            res.status(500).json({"error": err.message});
            return;
        }
        res.json({ message: "success" });
    });
});

// Suggestions API
app.get('/api/suggestions', (req, res) => {
    db.all("SELECT * FROM suggestions WHERE status = 'pending'", [], (err, rows) => {
        if (err) {
            res.status(500).json({"error": err.message});
            return;
        }
        res.json(rows.map(r => ({ ...r, data: JSON.parse(r.data) })));
    });
});

app.post('/api/suggestions', (req, res) => {
    const data = JSON.stringify(req.body);
    db.run(`INSERT INTO suggestions (data) VALUES (?)`, [data], function(err) {
        if (err) {
            res.status(500).json({"error": err.message});
            return;
        }
        res.json({ message: "Suggestion submitted successfully." });
    });
});

app.put('/api/suggestions/:id', (req, res) => {
    const { status } = req.body; // 'approved' or 'rejected'
    db.run(`UPDATE suggestions SET status = ? WHERE id = ?`, [status, req.params.id], function(err) {
        if (err) {
            res.status(500).json({"error": err.message});
            return;
        }
        res.json({ message: "success" });
    });
});

// Fallback to index.html for SPA
app.use( (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
