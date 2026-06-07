require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const { GoogleGenAI } = require('@google/genai');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

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

// Data Versioning
const CURRENT_SCHEMA_VERSION = 3;

// Mongoose Schemas (Dynamic & Flexible)
const userSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true, lowercase: true },
    password: { type: String, required: true },
    isOnboardingCompleted: { type: Boolean, default: false },
    age: Number,
    gender: String,
    height: Number,
    nutrition_preferences: mongoose.Schema.Types.Mixed, // e.g. { diet, foodPrefs }
    workout_days_per_week: Number,
    meals_per_day: Number,
    visual_goals: String,
    created_at: { type: Date, default: Date.now }
});

userSchema.pre('save', async function(next) {
    if (!this.isModified('password')) return next();
    try {
        const salt = await bcrypt.genSalt(10);
        this.password = await bcrypt.hash(this.password, salt);
        next();
    } catch (err) {
        next(err);
    }
});

const User = mongoose.model('User', userSchema);

// Middleware
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) return res.status(401).json({ error: 'גישה נדחתה. חסר טוקן אימות.' });

    jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret_for_dev', (err, user) => {
        if (err) return res.status(403).json({ error: 'טוקן לא חוקי או פג תוקף.' });
        req.user = user;
        next();
    });
}

// Auth Routes
app.post('/api/auth/register', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ error: 'חסרים אימייל או סיסמה' });
        
        const existingUser = await User.findOne({ email: email.toLowerCase() });
        if (existingUser) return res.status(400).json({ error: 'משתמש עם אימייל זה כבר קיים.' });
        
        const user = new User({ email: email.toLowerCase(), password });
        await user.save();
        
        const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET || 'fallback_secret_for_dev', { expiresIn: '30d' });
        res.json({ token, userId: user._id, isOnboardingCompleted: user.isOnboardingCompleted });
    } catch (e) {
        res.status(500).json({ error: 'שגיאת שרת פנימית ברישום.' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ error: 'חסרים אימייל או סיסמה' });
        
        const user = await User.findOne({ email: email.toLowerCase() });
        if (!user) return res.status(400).json({ error: 'משתמש לא נמצא.' });
        
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ error: 'סיסמה שגויה.' });
        
        const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET || 'fallback_secret_for_dev', { expiresIn: '30d' });
        res.json({ token, userId: user._id, isOnboardingCompleted: user.isOnboardingCompleted });
    } catch (e) {
        res.status(500).json({ error: 'שגיאת שרת פנימית בהתחברות.' });
    }
});

const biweeklyTrackingSchema = new mongoose.Schema({
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    tracking_date: { type: Date, default: Date.now },
    weight: Number,
    measurements: mongoose.Schema.Types.Mixed,
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
    portion_budget: mongoose.Schema.Types.Mixed,
    portion_bank: mongoose.Schema.Types.Mixed,
    portion_definitions: mongoose.Schema.Types.Mixed,
    workout_plan: mongoose.Schema.Types.Mixed,  // Saves the JSON array natively
    cardio_and_neat: mongoose.Schema.Types.Mixed,
    workout_logs: [mongoose.Schema.Types.Mixed], // Progressive Overload tracking
    ai_feedback: String,
    is_active: { type: Boolean, default: true },
    schema_version: { type: Number, default: 1 },
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
    אתה תזונאי קליני ומאמן כושר מקצועי ברמת עלית.
    תפקידך לייצר תוכנית תזונה ואימונים מותאמת אישית, מפורטת ומדויקת בעברית.
    עליך להחזיר אך ורק אובייקט JSON תקין (ללא כל Markdown וללא שום טקסט מילולי לפני או אחרי האובייקט).
    
    חוקי תזונה מוחלטים - מעבר ל'בנק מנות' (Exchange Lists):
    1. ביטול ארוחות קבועות: חל איסור מוחלט לייצר תפריט המכיל ארוחות ספציפיות מסודרות לפי זמנים (בוקר, צהריים, ערב).
    2. קיבוע הגדרת המנות (Hardcoded Definitions) - חובה על המודל לייצר את אובייקט ה-portion_definitions תמיד עם הערכים המדויקים הבאים עבור מנה אחת:
       - פחמימה (carbs): 15g פחמימה, 3g חלבון, 1g שומן -> 80 קלוריות למנה.
       - חלבון (protein): 20g חלבון, 5g שומן, 0g פחמימה -> 125 קלוריות למנה.
       - שומן (fats): 5g שומן, 1g חלבון, 1.5g פחמימה -> 55 קלוריות למנה.
    3. חישוב תקציב יומי (Daily Budget Math): כשאתה מחשב את מספר המנות היומי של המתאמן (portionBudget), השתמש אך ורק בערכים הקלוריים הנ"ל (80, 125, 55) לחלוקת התקציב. ודא שהסך הקלורי היומי שמתקבל מהכפלת מנות אלו מתכנס במדויק ל-targetCalories.
    4. חישוב בנק התחליפים (Portion Bank Grams): כמות הגרמים של כל מאכל שווה למנה אחת חייבת לקחת בחשבון את המאקרו המשולב. כמות הגרמים של טחינה במנת שומן חייבת להכיל בתוכה את ה-5 גרם שומן נטו, לצד הפחמימה והחלבון הנלווים, וכך גם לגבי מקורות הפחמימה (15g פחמימה נטו בתוך משקל האורז) והחלבון.
    5. חוק פריטים משתנים/גמישים: עבור פריטים מורכבים כמו לחם, ייצר כיתוב גמיש, לדוגמה: 'לחם מכל סוג (עד 80 קלוריות ו-15g פחמימה) - פרוסה אחת השווה למנה אחת'.
    
    חוקי אימון מוחלטים:
    1. כל אימון חייב להתחיל בסעיף של 'חימום מפרקי דינמי וספציפי'.
    2. סדר התרגילים חייב להיות אנליטי: תמיד להתחיל בתרגילים מורכבים כבדים לעבור לתרגילים מורכבים משניים, ורק בסוף לבצע תרגילי בידוד.
    3. חובה לשלב הנחיות ליישום Progressive Overload.
    
    מבנה ה-JSON המחייב (SCHEMA קשיח - אין לחרוג ממנו, חובה להשתמש במפתחות אלו בדיוק, והערכים בתקציב חייבים להיות מספרים שלמים Int בלבד):
    {
        "schema_version": ${CURRENT_SCHEMA_VERSION},
        "targetCalories": <מספר שלם>,
        "proteinGrams": <מספר שלם>,
        "carbsGrams": <מספר שלם>,
        "fatsGrams": <מספר שלם>,
        "portionBudget": {
            "carbs": <מספר שלם בלבד, למשל: 5>,
            "protein": <מספר שלם בלבד, למשל: 6>,
            "fats": <מספר שלם בלבד, למשל: 3>
        },
        "portion_definitions": {
            "carbs": { "calories": <מספר שלם>, "grams": <מספר שלם> },
            "protein": { "calories": <מספר שלם>, "grams": <מספר שלם> },
            "fats": { "calories": <מספר שלם>, "grams": <מספר שלם> }
        },
        "portionBank": {
            "carbs": [ { "name": "שם הפריט", "amount": "כמות בגרמים השווה למנת פחמימה אחת" } ],
            "protein": [ { "name": "שם הפריט", "amount": "כמות בגרמים השווה למנת חלבון אחת" } ],
            "fats": [ { "name": "שם הפריט", "amount": "כמות בגרמים השווה למנת שומן אחת" } ]
        },
        "workoutPlan": [
            { "day": "שם היום", "title": "כותרת האימון", "exercises": [
                { "name": "שם התרגיל", "details": "פרטי התרגיל, סטים, חזרות והנחיות" }
            ]}
        ],
        "cardioAndNeat": {
            "dailyStepsTarget": <מספר>,
            "weeklyCardio": "הנחיות לאימון אירובי שבועי"
        }
    }
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

async function generateCheckinAI(oldProgram, newTracking, feelings, workoutLogs = []) {
    const systemPrompt = `
    אתה תזונאי קליני ומאמן כושר מקצועי שעוקב אחר מתאמן.
    קבל את נתוני העבר, המשקל החדש ותחושות המתאמן בשבועיים האחרונים.
    להלן היסטוריית האימונים האחרונה של המתאמן (הכוללת תיעוד מדויק ברמת הסט הבודד). עליך להפיק את תוכנית האימון החדשה תוך יישום קפדני של Progressive Overload (עומס יסף) בהתבסס על נתונים אלו. עליך לנתח את העלייה או הירידה בכוח מסט לסט, ולחשב לפיהן את משקלי היעד החדשים. עבור תרגילים מורכבים, דרוש הוספה של 1.25 עד 2.5 ק"ג למשקל העבודה לעומת השבוע שעבר, או הוספת חזרה אחת לכל סט באותו המשקל. ודא שתוכנית האימון החדשה מציגה את משקלי היעד המדויקים שעל המתאמן להרים בכל סט וסט.
    עליך לספק פידבק מקצועי קצר ומעודד (בעברית), ולעדכן את הקלוריות והתוכנית בהתאם.

    חוקי תזונה מוחלטים:
    1. קיבוע הגדרת המנות (Hardcoded Definitions) - חובה על המודל לייצר את אובייקט ה-portion_definitions תמיד עם הערכים המדויקים הבאים עבור מנה אחת:
       - פחמימה (carbs): 15g פחמימה, 3g חלבון, 1g שומן -> 80 קלוריות למנה.
       - חלבון (protein): 20g חלבון, 5g שומן, 0g פחמימה -> 125 קלוריות למנה.
       - שומן (fats): 5g שומן, 1g חלבון, 1.5g פחמימה -> 55 קלוריות למנה.
    2. חישוב תקציב יומי (Daily Budget Math): כשאתה מחשב את מספר המנות היומי של המתאמן (portionBudget), השתמש אך ורק בערכים הקלוריים הנ"ל (80, 125, 55) לחלוקת התקציב, כדי להבטיח שהסך הקלורי יתכנס בדיוק.
    3. חישוב בנק התחליפים (Portion Bank Grams): כמות הגרמים של כל מאכל צריכה לכלול את המאקרו המשולב (שומן נטו בתוך טחינה, פחמימה נטו בתוך אורז וכו').
    החזר אך ורק אובייקט JSON בתבנית הבאה (SCHEMA קשיח, מספרים שלמים בלבד בתקציב):
    {
        "schema_version": ${CURRENT_SCHEMA_VERSION},
        "ai_feedback": "טקסט הפידבק החכם שלך...",
        "targetCalories": <מספר שלם>,
        "proteinGrams": <מספר שלם>,
        "carbsGrams": <מספר שלם>,
        "fatsGrams": <מספר שלם>,
        "portionBudget": {
            "carbs": <מספר שלם בלבד, למשל: 5>,
            "protein": <מספר שלם בלבד, למשל: 6>,
            "fats": <מספר שלם בלבד, למשל: 3>
        },
        "portion_definitions": {
            "carbs": { "calories": <מספר שלם>, "grams": <מספר שלם> },
            "protein": { "calories": <מספר שלם>, "grams": <מספר שלם> },
            "fats": { "calories": <מספר שלם>, "grams": <מספר שלם> }
        },
        "portionBank": {
            "carbs": [ { "name": "שם הפריט", "amount": "כמות בגרמים השווה למנת פחמימה אחת" } ],
            "protein": [ { "name": "שם הפריט", "amount": "כמות בגרמים השווה למנת חלבון אחת" } ],
            "fats": [ { "name": "שם הפריט", "amount": "כמות בגרמים השווה למנת שומן אחת" } ]
        },
        "workoutPlan": [ ...מערך אימונים עם חימום דינמי ו-Progressive overload... ],
        "cardioAndNeat": {
            "dailyStepsTarget": <מספר יעד צעדים יומי מדויק>,
            "weeklyCardio": "הנחיות לאימון אירובי שבועי: עצימות, משך וסוג"
        }
    }
    `;

    const userPrompt = `
    נתוני תוכנית קודמת:
    קלוריות: ${oldProgram.target_calories}
    תקציב מנות קודם (JSON חלקי): ${JSON.stringify(oldProgram.portion_budget)}
    
    נתונים מהשבועיים האחרונים:
    משקל נוכחי: ${newTracking.weight} ק"ג
    תחושות / הערות המתאמן: ${feelings || 'אין הערות'}
    
    היסטוריית ביצועי אימונים קודמים (Progressive Overload):
    ${workoutLogs && workoutLogs.length > 0 ? JSON.stringify(workoutLogs) : 'אין נתוני אימונים מתועדים קודמים.'}
    
    אנא עדכן את התוכנית, הוסף משוב אישי, והחזר כ-JSON בלבד.
    `;

    return await callGemini(systemPrompt, userPrompt);
}

const cpUpload = upload.fields([
    { name: 'image-front', maxCount: 1 }, { name: 'image-back', maxCount: 1 }, { name: 'image-side', maxCount: 1 }
]);

app.post('/api/onboarding', authenticateToken, cpUpload, async (req, res) => {
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

        const user = await User.findByIdAndUpdate(req.user.id, {
            age: parseInt(data.age),
            gender: data.gender,
            height: parseFloat(data.height),
            nutrition_preferences: { diet: data.diet, foodPrefs: data['food-prefs'] },
            workout_days_per_week: parseInt(data['workout-days']),
            meals_per_day: parseInt(data['meals-per-day']),
            visual_goals: data['visual-goals'],
            isOnboardingCompleted: true
        }, { new: true });
        
        if (!user) return res.status(404).json({ error: 'משתמש לא נמצא במערכת.' });

        const newTracking = new BiweeklyTracking({
            user_id: user._id,
            weight: parseFloat(data.weight),
            measurements: data.measurements ? JSON.parse(data.measurements) : {},
            image_front_url: imageFrontUrl,
            image_back_url: imageBackUrl,
            image_side_url: imageSideUrl
        });
        await newTracking.save();

        const newProgram = new Program({
            user_id: user._id,
            schema_version: aiProgram.schema_version || CURRENT_SCHEMA_VERSION,
            target_calories: aiProgram.targetCalories,
            protein_grams: aiProgram.proteinGrams,
            carbs_grams: aiProgram.carbsGrams,
            fats_grams: aiProgram.fatsGrams,
            portion_budget: aiProgram.portionBudget,
            portion_bank: aiProgram.portionBank,
            portion_definitions: aiProgram.portion_definitions,
            workout_plan: aiProgram.workoutPlan, // Saved natively as JSON due to Mixed type
            cardio_and_neat: aiProgram.cardioAndNeat
        });
        await newProgram.save();

        return res.status(200).json({ message: 'הנתונים נשמרו בהצלחה', userId: user._id.toString() });
    } catch (error) {
        console.error("Server error during onboarding:", error);
        res.status(500).json({ error: 'שגיאת שרת פנימית. נסה שוב.' });
    }
});

app.post('/api/checkin', authenticateToken, cpUpload, async (req, res) => {
    try {
        const data = req.body;
        const files = req.files || {};
        const userId = req.user.id;

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
            aiCheckin = await generateCheckinAI(
                oldProgram, 
                { weight: parseFloat(data.weight) }, 
                data.feelings, 
                oldProgram.workout_logs || []
            );
        } catch (e) {
            return res.status(500).json({ error: e.message });
        }

        const imageFrontUrl = files['image-front'] ? `/uploads/${files['image-front'][0].filename}` : null;
        const imageBackUrl = files['image-back'] ? `/uploads/${files['image-back'][0].filename}` : null;
        const imageSideUrl = files['image-side'] ? `/uploads/${files['image-side'][0].filename}` : null;

        const newTracking = new BiweeklyTracking({
            user_id: userId,
            weight: parseFloat(data.weight),
            measurements: data.measurements ? JSON.parse(data.measurements) : {},
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
            schema_version: aiCheckin.schema_version || CURRENT_SCHEMA_VERSION,
            target_calories: aiCheckin.targetCalories,
            protein_grams: aiCheckin.proteinGrams,
            carbs_grams: aiCheckin.carbsGrams,
            fats_grams: aiCheckin.fatsGrams,
            portion_budget: aiCheckin.portionBudget,
            portion_bank: aiCheckin.portionBank,
            portion_definitions: aiCheckin.portion_definitions,
            workout_plan: aiCheckin.workoutPlan,
            cardio_and_neat: aiCheckin.cardioAndNeat,
            ai_feedback: aiCheckin.ai_feedback
        });
        await newProgram.save();

        return res.status(200).json({ message: 'העדכון בוצע בהצלחה!', userId: userId });
    } catch (error) {
        console.error("Server error during checkin:", error);
        res.status(500).json({ error: 'שגיאת שרת פנימית. נסה שוב.' });
    }
});

app.post('/api/log-workout', authenticateToken, async (req, res) => {
    try {
        const { workoutData } = req.body;
        const userId = req.user.id;
        
        if (!userId || !workoutData) {
            return res.status(400).json({ error: 'חסרים מזהה משתמש או נתוני אימון.' });
        }

        // מוצאים את התוכנית הפעילה של המשתמש
        const activeProgram = await Program.findOne({ user_id: userId, is_active: true });
        if (!activeProgram) {
            return res.status(404).json({ error: 'לא נמצאה תוכנית אימון פעילה עבור משתמש זה.' });
        }

        // וידוא שהמערך קיים
        if (!activeProgram.workout_logs) {
            activeProgram.workout_logs = [];
        }

        // הוספת נתוני האימון המעורבים (תאריך, תרגיל, סטים, חזרות, משקל) למערך
        activeProgram.workout_logs.push(workoutData);
        
        // ציון מפורש ששדה Mixed עבר עדכון כדי להבטיח שמירה נכונה ב-Mongoose
        activeProgram.markModified('workout_logs');
        
        await activeProgram.save();

        return res.status(200).json({ message: 'אימון תועד ונשמר בהצלחה!' });
    } catch (error) {
        console.error("CRITICAL ERROR: Failed to log workout for progressive overload:", error);
        return res.status(500).json({ error: 'שגיאה פנימית בשרת בעת ניסיון לשמור את נתוני האימון.' });
    }
});

app.get('/api/user/me', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        
        const user = await User.findById(userId);
        if (!user) { return res.status(404).json({ error: 'משתמש לא נמצא.' }); }
        
        const tracking = await BiweeklyTracking.findOne({ user_id: userId }).sort({ created_at: -1 });
        let program = await Program.findOne({ user_id: userId, is_active: true });
        
        // --- Auto-Migration / Lazy Migration Interceptor ---
        if (program && (!program.schema_version || program.schema_version < CURRENT_SCHEMA_VERSION)) {
            console.log(`Auto-migrating user ${userId} to schema_version ${CURRENT_SCHEMA_VERSION}...`);
            
            // Gather existing data for the AI to rebuild the program
            const height = user.height || 175; // Default if old user didn't save height
            const weight = tracking ? tracking.weight : 70;
            
            const migrationData = {
                age: user.age || 30,
                gender: user.gender || 'male',
                height: height,
                weight: weight,
                diet: user.nutrition_preferences?.diet || 'רגילה',
                'food-prefs': user.nutrition_preferences?.foodPrefs || '',
                'workout-days': user.workout_days_per_week || 3,
                'visual-goals': user.visual_goals || 'חיטוב וירידה באחוזי שומן'
            };

            try {
                // We use generateProgramAI to give them a completely fresh V2 program based on their physical stats
                const aiProgram = await generateProgramAI(migrationData);
                
                // Update the document in MongoDB
                program.schema_version = aiProgram.schema_version || CURRENT_SCHEMA_VERSION;
                program.target_calories = aiProgram.targetCalories;
                program.protein_grams = aiProgram.proteinGrams;
                program.carbs_grams = aiProgram.carbsGrams;
                program.fats_grams = aiProgram.fatsGrams;
                program.portion_budget = aiProgram.portionBudget;
                program.portion_bank = aiProgram.portionBank;
                program.portion_definitions = aiProgram.portion_definitions;
                program.workout_plan = aiProgram.workoutPlan;
                program.cardio_and_neat = aiProgram.cardioAndNeat;
                
                await program.save();
                console.log(`User ${userId} successfully auto-migrated.`);
            } catch (e) {
                console.error(`Auto-migration failed for user ${userId}:`, e.message);
                // We do not throw or crash. The frontend will just receive the old program and fallback gracefully (if any), 
                // but ideally the next request will retry.
            }
        }
        
        const result = {
            id: user._id.toString(), // Map _id to id for frontend compatibility
            isOnboardingCompleted: user.isOnboardingCompleted,
            visual_goals: user.visual_goals,
            workout_days_per_week: user.workout_days_per_week,
            gender: user.gender,
            weight: tracking ? tracking.weight : null,
            measurements: tracking ? tracking.measurements : null,
            tracking_date: tracking ? tracking.tracking_date : null,
            target_calories: program ? program.target_calories : null,
            protein_grams: program ? program.protein_grams : null,
            carbs_grams: program ? program.carbs_grams : null,
            fats_grams: program ? program.fats_grams : null,
            portion_budget: program && program.portion_budget ? JSON.stringify(program.portion_budget) : null,
            portion_bank: program && program.portion_bank ? JSON.stringify(program.portion_bank) : null,
            portion_definitions: program && program.portion_definitions ? JSON.stringify(program.portion_definitions) : null,
            workout_plan: program && program.workout_plan ? JSON.stringify(program.workout_plan) : null,
            cardio_and_neat: program && program.cardio_and_neat ? JSON.stringify(program.cardio_and_neat) : null,
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
