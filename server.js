require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const { GoogleGenAI } = require('@google/genai');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) { cb(null, uploadDir); },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ storage: storage, limits: { fileSize: 10 * 1024 * 1024 } });

// Database Setup
const dbPath = path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) { console.error('Error opening database', err.message); } 
    else {
        db.serialize(() => {
            db.run(`CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY, age INTEGER, gender TEXT, nutrition_preferences TEXT, workout_days_per_week INTEGER, visual_goals TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);
            db.run(`ALTER TABLE users ADD COLUMN age INTEGER`, () => {});
            db.run(`ALTER TABLE users ADD COLUMN gender TEXT`, () => {});

            db.run(`CREATE TABLE IF NOT EXISTS biweekly_tracking (
                id TEXT PRIMARY KEY, user_id TEXT, tracking_date DATE, weight REAL, waist_circumference REAL, shoulders_circumference REAL, arms_circumference REAL, thighs_circumference REAL, personal_feelings TEXT, image_front_url TEXT, image_back_url TEXT, image_side_url TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (user_id) REFERENCES users(id)
            )`);
            db.run(`ALTER TABLE biweekly_tracking ADD COLUMN personal_feelings TEXT`, () => {});

            db.run(`CREATE TABLE IF NOT EXISTS programs (
                id TEXT PRIMARY KEY, user_id TEXT, target_calories INTEGER, protein_grams INTEGER, carbs_grams INTEGER, fats_grams INTEGER, daily_menu TEXT, workout_plan TEXT, ai_feedback TEXT, is_active BOOLEAN DEFAULT 1, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (user_id) REFERENCES users(id)
            )`);
            db.run(`ALTER TABLE programs ADD COLUMN ai_feedback TEXT`, () => {});
        });
    }
});

function uuidv4() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// AI Functions using @google/genai
// אנו מאתחלים את ה-SDK בתוך הפונקציה כדי שהשרת לא יקרוס בעלייה במקרה והמשתמש עדיין לא הזין מפתח

async function callGemini(systemInstruction, userPrompt) {
    if (!process.env.GEMINI_API_KEY) {
        throw new Error('חסר מפתח API. אנא עדכן את קובץ ה-.env עם מפתח תקין.');
    }
    
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    let text = "";
    
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: userPrompt,
            config: {
                systemInstruction: systemInstruction,
                responseMimeType: 'application/json',
                temperature: 0.2
            }
        });

        text = response.text;
        
        // Robust cleanup: strip markdown blocks
        let cleanedText = text.replace(/```json/gi, '').replace(/```/g, '').trim();
        
        // Failsafe: extract exactly from first { to last }
        const firstBrace = cleanedText.indexOf('{');
        const lastBrace = cleanedText.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1) {
            cleanedText = cleanedText.substring(firstBrace, lastBrace + 1);
        }

        return JSON.parse(cleanedText);
    } catch (e) {
        console.error("AI API Error or JSON Parse Error:", e);
        console.error("Raw Text received from AI:", text);
        throw new Error('שגיאה בתקשורת מול שרת ה-AI או בפענוח הנתונים (JSON). נסה שוב.');
    }
}

async function generateProgramAI(data) {
    const systemPrompt = `
    אתה תזונאי קליני ומאמן כושר מקצועי.
    תפקידך לייצר תוכנית תזונה ואימונים מותאמת אישית מפורטת בעברית.
    עליך להחזיר אך ורק אובייקט JSON תקין (ללא כל Markdown וללא שום טקסט מילולי לפני או אחרי האובייקט).
    האובייקט חייב לכלול בדיוק את המפתחות הבאים:
    {
        "targetCalories": <מספר>,
        "proteinGrams": <מספר>,
        "carbsGrams": <מספר>,
        "fatsGrams": <מספר>,
        "dailyMenu": [
            { "meal": "שם הארוחה (למשל: ארוחת בוקר)", "items": "פירוט המרכיבים והמנות" }
        ],
        "workoutPlan": [
            { "day": "שם היום (למשל: יום 1)", "title": "כותרת האימון", "exercises": [
                { "name": "שם התרגיל", "details": "פרטי התרגיל, סטים וחזרות" }
            ]}
        ]
    }
    חשב את ה-BMR באמצעות נוסחת Mifflin-St Jeor והתאם את הקלוריות ויחסי המאקרו לפי המטרות וההעדפות שהוזנו.
    `;

    const userPrompt = `
    פרטי מתאמן חדש:
    גיל: ${data.age}
    מגדר: ${data.gender === 'male' ? 'זכר' : 'נקבה'}
    גובה: ${data.height} ס"מ
    משקל: ${data.weight} ק"ג
    העדפה תזונתית: ${data.diet}
    מאכלים/העדפות (אם צוינו): ${data['food-prefs']}
    ימי אימון בשבוע: ${data['workout-days']}
    מטרות ויזואליות / רצונות: ${data['visual-goals']}
    
    אנא החזר את ה-JSON עכשיו.
    `;

    return await callGemini(systemPrompt, userPrompt);
}

async function generateCheckinAI(oldProgram, newTracking, feelings) {
    const systemPrompt = `
    אתה תזונאי קליני ומאמן כושר מקצועי שעוקב אחר מתאמן.
    קבל את נתוני העבר, המשקל החדש ותחושות המתאמן בשבועיים האחרונים.
    עליך לספק פידבק מקצועי קצר ומעודד (בעברית), ולעדכן את הקלוריות והתוכנית בהתאם.
    החזר אך ורק אובייקט JSON בתבנית הבאה:
    {
        "ai_feedback": "טקסט הפידבק החכם שלך...",
        "targetCalories": <מספר הקלוריות המעודכן>,
        "proteinGrams": <מספר>,
        "carbsGrams": <מספר>,
        "fatsGrams": <מספר>,
        "dailyMenu": [ ...מערך ארוחות מעודכן או זהה... ],
        "workoutPlan": [ ...מערך אימונים... ]
    }
    `;

    const userPrompt = `
    נתוני תוכנית קודמת:
    קלוריות: ${oldProgram.target_calories}
    תפריט קודם (JSON חלקי): ${oldProgram.daily_menu.substring(0, 300)}...
    
    נתונים מהשבועיים האחרונים:
    משקל נוכחי: ${newTracking.weight} ק"ג
    תחושות / הערות המתאמן: ${feelings || 'אין הערות'}
    
    אנא עדכן את התוכנית, הוסף משוב אישי, והחזר כ-JSON בלבד.
    `;

    return await callGemini(systemPrompt, userPrompt);
}

const cpUpload = upload.fields([
    { name: 'image-front', maxCount: 1 }, { name: 'image-back', maxCount: 1 }, { name: 'image-side', maxCount: 1 }
]);

app.post('/api/onboarding', cpUpload, async (req, res) => {
    try {
        const data = req.body;
        const files = req.files || {};

        if (!data.height || !data.weight || !data['workout-days'] || !data.age || !data.gender) {
            return res.status(400).json({ error: 'חסרים נתונים חובה.' });
        }

        // Call AI FIRST before touching DB, allowing graceful rollback/rejection
        let aiProgram;
        try {
            aiProgram = await generateProgramAI(data);
        } catch (e) {
            return res.status(500).json({ error: e.message });
        }

        const imageFrontUrl = files['image-front'] ? `/uploads/${files['image-front'][0].filename}` : null;
        const imageBackUrl = files['image-back'] ? `/uploads/${files['image-back'][0].filename}` : null;
        const imageSideUrl = files['image-side'] ? `/uploads/${files['image-side'][0].filename}` : null;

        const userId = uuidv4();
        const nutritionPreferences = JSON.stringify({ diet: data.diet, foodPrefs: data['food-prefs'] });

        db.serialize(() => {
            db.run("BEGIN TRANSACTION");

            db.run(`INSERT INTO users (id, age, gender, nutrition_preferences, workout_days_per_week, visual_goals) VALUES (?, ?, ?, ?, ?, ?)`, 
            [userId, parseInt(data.age), data.gender, nutritionPreferences, parseInt(data['workout-days']), data['visual-goals']], 
            function(err) {
                if (err) { db.run("ROLLBACK"); return res.status(500).json({ error: 'שגיאה בשמירת פרטי המשתמש.' }); }

                const trackingId = uuidv4();
                db.run(`INSERT INTO biweekly_tracking (
                    id, user_id, tracking_date, weight, waist_circumference, shoulders_circumference, arms_circumference, thighs_circumference, image_front_url, image_back_url, image_side_url
                ) VALUES (?, ?, date('now'), ?, ?, ?, ?, ?, ?, ?, ?)`, 
                [
                    trackingId, userId, 
                    parseFloat(data.weight), parseFloat(data.waist), parseFloat(data.shoulders), parseFloat(data.arms), parseFloat(data.thighs),
                    imageFrontUrl, imageBackUrl, imageSideUrl
                ],
                function(err) {
                    if (err) { db.run("ROLLBACK"); return res.status(500).json({ error: 'שגיאה בשמירת נתוני המעקב.' }); }

                    const programId = uuidv4();
                    db.run(`INSERT INTO programs (
                        id, user_id, target_calories, protein_grams, carbs_grams, fats_grams, daily_menu, workout_plan
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        programId, userId,
                        aiProgram.targetCalories, aiProgram.proteinGrams, aiProgram.carbsGrams, aiProgram.fatsGrams,
                        JSON.stringify(aiProgram.dailyMenu), JSON.stringify(aiProgram.workoutPlan)
                    ],
                    function(err) {
                        if (err) { db.run("ROLLBACK"); return res.status(500).json({ error: 'שגיאה ביצירת התוכנית.' }); }
                        
                        db.run("COMMIT");
                        return res.status(200).json({ message: 'הנתונים נשמרו בהצלחה', userId: userId });
                    });
                });
            });
        });
    } catch (error) {
        console.error("Server error:", error);
        res.status(500).json({ error: 'שגיאת שרת פנימית.' });
    }
});

app.post('/api/checkin', cpUpload, async (req, res) => {
    try {
        const data = req.body;
        const files = req.files || {};
        const userId = data.userId;

        if (!userId || !data.weight) {
            return res.status(400).json({ error: 'חסרים נתוני משתמש או משקל נוכחי.' });
        }

        // Fetch Old Program First
        db.get(`SELECT * FROM programs WHERE user_id = ? AND is_active = 1`, [userId], async (err, oldProgram) => {
            if (err || !oldProgram) {
                return res.status(500).json({ error: 'תוכנית קודמת לא נמצאה: ' + (err ? err.message : '') });
            }

            // Call AI BEFORE opening transaction
            let aiCheckin;
            try {
                aiCheckin = await generateCheckinAI(oldProgram, { weight: parseFloat(data.weight) }, data.feelings);
            } catch (e) {
                return res.status(500).json({ error: e.message });
            }

            const imageFrontUrl = files['image-front'] ? `/uploads/${files['image-front'][0].filename}` : null;
            const imageBackUrl = files['image-back'] ? `/uploads/${files['image-back'][0].filename}` : null;
            const imageSideUrl = files['image-side'] ? `/uploads/${files['image-side'][0].filename}` : null;

            db.serialize(() => {
                db.run("BEGIN TRANSACTION");

                const trackingId = uuidv4();
                db.run(`INSERT INTO biweekly_tracking (
                    id, user_id, tracking_date, weight, waist_circumference, shoulders_circumference, arms_circumference, thighs_circumference, personal_feelings, image_front_url, image_back_url, image_side_url
                ) VALUES (?, ?, date('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?)`, 
                [
                    trackingId, userId, 
                    parseFloat(data.weight), parseFloat(data.waist), parseFloat(data.shoulders), parseFloat(data.arms), parseFloat(data.thighs),
                    data.feelings || '', imageFrontUrl, imageBackUrl, imageSideUrl
                ], 
                function(err) {
                    if (err) { db.run("ROLLBACK"); return res.status(500).json({ error: 'שגיאה בשמירת נתוני המעקב: ' + err.message }); }

                    // Deactivate old program
                    db.run(`UPDATE programs SET is_active = 0 WHERE id = ?`, [oldProgram.id], (err) => {
                        if (err) { db.run("ROLLBACK"); return res.status(500).json({ error: 'שגיאה בעדכון התוכנית הקודמת.' }); }

                        // Insert new program
                        const newProgramId = uuidv4();
                        db.run(`INSERT INTO programs (
                            id, user_id, target_calories, protein_grams, carbs_grams, fats_grams, daily_menu, workout_plan, ai_feedback
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [
                            newProgramId, userId,
                            aiCheckin.targetCalories, aiCheckin.proteinGrams, aiCheckin.carbsGrams, aiCheckin.fatsGrams,
                            JSON.stringify(aiCheckin.dailyMenu), JSON.stringify(aiCheckin.workoutPlan), aiCheckin.ai_feedback
                        ],
                        function(err) {
                            if (err) { db.run("ROLLBACK"); return res.status(500).json({ error: 'שגיאה ביצירת התוכנית החדשה.' }); }
                            
                            db.run("COMMIT");
                            return res.status(200).json({ message: 'העדכון בוצע בהצלחה!', userId: userId });
                        });
                    });
                });
            });
        });
    } catch (error) {
        console.error("Server error:", error);
        res.status(500).json({ error: 'שגיאת שרת פנימית.' });
    }
});

app.get('/api/user/:id', (req, res) => {
    const userId = req.params.id;
    
    const query = `
        SELECT u.id, u.visual_goals, u.workout_days_per_week,
               t.weight, t.waist_circumference, t.tracking_date,
               p.target_calories, p.protein_grams, p.carbs_grams, p.fats_grams, p.daily_menu, p.workout_plan, p.ai_feedback
        FROM users u
        LEFT JOIN biweekly_tracking t ON u.id = t.user_id
        LEFT JOIN programs p ON u.id = p.user_id AND p.is_active = 1
        WHERE u.id = ?
        ORDER BY t.created_at DESC
        LIMIT 1
    `;
    
    db.get(query, [userId], (err, row) => {
        if (err) { return res.status(500).json({ error: 'שגיאה בשליפת נתוני המשתמש.' }); }
        if (!row) { return res.status(404).json({ error: 'משתמש לא נמצא.' }); }
        res.json(row);
    });
});

app.use('/uploads', express.static(uploadDir));
app.use(express.static(path.join(__dirname)));

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
