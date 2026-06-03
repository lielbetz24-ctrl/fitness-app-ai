require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
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

// MongoDB Connection
const mongoURI = process.env.MONGODB_URI;
if (!mongoURI) {
    console.error("CRITICAL ERROR: MONGODB_URI is not defined in .env");
    process.exit(1);
}

mongoose.connect(mongoURI)
    .then(() => console.log('Successfully connected to MongoDB.'))
    .catch(err => {
        console.error('Error connecting to MongoDB on startup:', err.message);
        process.exit(1);
    });

mongoose.connection.on('error', err => {
    console.error('MongoDB connection lost/error:', err.message);
});

// Mongoose Schemas (Dynamic & Flexible)
const userSchema = new mongoose.Schema({
    age: Number,
    gender: String,
    nutrition_preferences: mongoose.Schema.Types.Mixed, // e.g. { diet, foodPrefs }
    workout_days_per_week: Number,
    visual_goals: String,
    created_at: { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);

const biweeklyTrackingSchema = new mongoose.Schema({
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    tracking_date: { type: Date, default: Date.now },
    weight: Number,
    waist_circumference: Number,
    shoulders_circumference: Number,
    arms_circumference: Number,
    thighs_circumference: Number,
    personal_feelings: String,
    image_front_url: String,
    image_back_url: String,
    image_side_url: String,
    created_at: { type: Date, default: Date.now }
});
const BiweeklyTracking = mongoose.model('BiweeklyTracking', biweeklyTrackingSchema);

const programSchema = new mongoose.Schema({
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    target_calories: Number,
    protein_grams: Number,
    carbs_grams: Number,
    fats_grams: Number,
    daily_menu: mongoose.Schema.Types.Mixed,    // Saves the JSON array natively
    workout_plan: mongoose.Schema.Types.Mixed,  // Saves the JSON array natively
    ai_feedback: String,
    is_active: { type: Boolean, default: true },
    created_at: { type: Date, default: Date.now }
});
const Program = mongoose.model('Program', programSchema);

// AI Functions using @google/genai
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
    תפריט קודם (JSON חלקי): ${JSON.stringify(oldProgram.daily_menu).substring(0, 300)}...
    
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

        // Call AI FIRST before touching DB, allowing graceful rejection
        let aiProgram;
        try {
            aiProgram = await generateProgramAI(data);
        } catch (e) {
            return res.status(500).json({ error: e.message });
        }

        const imageFrontUrl = files['image-front'] ? `/uploads/${files['image-front'][0].filename}` : null;
        const imageBackUrl = files['image-back'] ? `/uploads/${files['image-back'][0].filename}` : null;
        const imageSideUrl = files['image-side'] ? `/uploads/${files['image-side'][0].filename}` : null;

        const newUser = new User({
            age: parseInt(data.age),
            gender: data.gender,
            nutrition_preferences: { diet: data.diet, foodPrefs: data['food-prefs'] },
            workout_days_per_week: parseInt(data['workout-days']),
            visual_goals: data['visual-goals']
        });
        await newUser.save();

        const newTracking = new BiweeklyTracking({
            user_id: newUser._id,
            weight: parseFloat(data.weight),
            waist_circumference: parseFloat(data.waist),
            shoulders_circumference: parseFloat(data.shoulders),
            arms_circumference: parseFloat(data.arms),
            thighs_circumference: parseFloat(data.thighs),
            image_front_url: imageFrontUrl,
            image_back_url: imageBackUrl,
            image_side_url: imageSideUrl
        });
        await newTracking.save();

        const newProgram = new Program({
            user_id: newUser._id,
            target_calories: aiProgram.targetCalories,
            protein_grams: aiProgram.proteinGrams,
            carbs_grams: aiProgram.carbsGrams,
            fats_grams: aiProgram.fatsGrams,
            daily_menu: aiProgram.dailyMenu, // Saved natively as JSON due to Mixed type
            workout_plan: aiProgram.workoutPlan // Saved natively as JSON due to Mixed type
        });
        await newProgram.save();

        return res.status(200).json({ message: 'הנתונים נשמרו בהצלחה', userId: newUser._id.toString() });
    } catch (error) {
        console.error("Server error during onboarding:", error);
        res.status(500).json({ error: 'שגיאת שרת פנימית. נסה שוב.' });
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
        const oldProgram = await Program.findOne({ user_id: userId, is_active: true });
        if (!oldProgram) {
            return res.status(404).json({ error: 'תוכנית קודמת לא נמצאה.' });
        }

        // Call AI BEFORE touching DB
        let aiCheckin;
        try {
            aiCheckin = await generateCheckinAI(oldProgram, { weight: parseFloat(data.weight) }, data.feelings);
        } catch (e) {
            return res.status(500).json({ error: e.message });
        }

        const imageFrontUrl = files['image-front'] ? `/uploads/${files['image-front'][0].filename}` : null;
        const imageBackUrl = files['image-back'] ? `/uploads/${files['image-back'][0].filename}` : null;
        const imageSideUrl = files['image-side'] ? `/uploads/${files['image-side'][0].filename}` : null;

        const newTracking = new BiweeklyTracking({
            user_id: userId,
            weight: parseFloat(data.weight),
            waist_circumference: parseFloat(data.waist),
            shoulders_circumference: parseFloat(data.shoulders),
            arms_circumference: parseFloat(data.arms),
            thighs_circumference: parseFloat(data.thighs),
            personal_feelings: data.feelings || '',
            image_front_url: imageFrontUrl,
            image_back_url: imageBackUrl,
            image_side_url: imageSideUrl
        });
        await newTracking.save();

        // Deactivate old program
        oldProgram.is_active = false;
        await oldProgram.save();

        // Insert new program
        const newProgram = new Program({
            user_id: userId,
            target_calories: aiCheckin.targetCalories,
            protein_grams: aiCheckin.proteinGrams,
            carbs_grams: aiCheckin.carbsGrams,
            fats_grams: aiCheckin.fatsGrams,
            daily_menu: aiCheckin.dailyMenu,
            workout_plan: aiCheckin.workoutPlan,
            ai_feedback: aiCheckin.ai_feedback
        });
        await newProgram.save();

        return res.status(200).json({ message: 'העדכון בוצע בהצלחה!', userId: userId });
    } catch (error) {
        console.error("Server error during checkin:", error);
        res.status(500).json({ error: 'שגיאת שרת פנימית. נסה שוב.' });
    }
});

app.get('/api/user/:id', async (req, res) => {
    try {
        const userId = req.params.id;
        
        const user = await User.findById(userId);
        if (!user) { return res.status(404).json({ error: 'משתמש לא נמצא.' }); }
        
        const tracking = await BiweeklyTracking.findOne({ user_id: userId }).sort({ created_at: -1 });
        const program = await Program.findOne({ user_id: userId, is_active: true });
        
        const result = {
            id: user._id.toString(), // Map _id to id for frontend compatibility
            visual_goals: user.visual_goals,
            workout_days_per_week: user.workout_days_per_week,
            weight: tracking ? tracking.weight : null,
            waist_circumference: tracking ? tracking.waist_circumference : null,
            tracking_date: tracking ? tracking.tracking_date : null,
            target_calories: program ? program.target_calories : null,
            protein_grams: program ? program.protein_grams : null,
            carbs_grams: program ? program.carbs_grams : null,
            fats_grams: program ? program.fats_grams : null,
            // JSON stringify the daily_menu and workout_plan because the frontend dashboard.js uses JSON.parse() on them!
            // We stringify it here so the frontend API remains perfectly unchanged.
            daily_menu: program && program.daily_menu ? JSON.stringify(program.daily_menu) : null,
            workout_plan: program && program.workout_plan ? JSON.stringify(program.workout_plan) : null,
            ai_feedback: program ? program.ai_feedback : null
        };
        
        res.json(result);
    } catch (error) {
        console.error("Server error fetching user:", error);
        res.status(500).json({ error: 'שגיאה בשליפת נתוני המשתמש.' });
    }
});

app.use('/uploads', express.static(uploadDir));
app.use(express.static(path.join(__dirname)));

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
