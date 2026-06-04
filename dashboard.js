document.addEventListener('DOMContentLoaded', async () => {
    const token = localStorage.getItem('token');
    if (!token) {
        window.location.replace('index.html');
        return;
    }
    const totalDays = 14;
    let daysPassed = 0; 
    let daysLeft = totalDays;
    
    const daysLeftEl = document.getElementById('days-left');
    const timerProgressEl = document.getElementById('timer-progress');
    const btnUpdate = document.getElementById('btn-update');

    daysLeftEl.textContent = daysLeft;
    setTimeout(() => { timerProgressEl.style.width = '0%'; }, 100);

    try {
        const response = await fetch(`/api/user/me`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (response.ok) {
            const data = await response.json();
            
            // Redirect to onboarding if no program exists
            if (!data.target_calories && !data.workout_plan) {
                window.location.href = 'index.html';
                return;
            }
                
                // Profile
                document.getElementById('val-weight').textContent = `${data.weight || '--'} ק"ג`;
                document.getElementById('val-waist').textContent = `${data.waist_circumference || '--'} ס"מ`;
                document.getElementById('val-days').textContent = data.workout_days_per_week || '--';
                document.getElementById('val-goal').textContent = data.visual_goals || 'לא הוגדרה מטרה ספציפית.';
                
                // Timer
                if (data.tracking_date) {
                    const trackingDate = new Date(data.tracking_date);
                    const diffTime = new Date().getTime() - trackingDate.getTime();
                    daysPassed = Math.max(0, Math.floor(diffTime / (1000 * 60 * 60 * 24)));
                    daysLeft = Math.max(0, totalDays - daysPassed);
                    
                    daysLeftEl.textContent = daysLeft;
                    const progress = Math.min(100, (daysPassed / totalDays) * 100);
                    setTimeout(() => { timerProgressEl.style.width = `${progress}%`; }, 100);

                    // For development testing, keep the button always enabled!
                    btnUpdate.disabled = false;
                    btnUpdate.textContent = 'בצע עדכון נתונים (פתוח לבדיקות)';
                    btnUpdate.classList.replace('btn-secondary', 'btn-primary');
                }

                // Show AI Feedback if exists
                if (data.ai_feedback) {
                    const feedbackSection = document.getElementById('ai-feedback-section');
                    const feedbackText = document.getElementById('val-feedback');
                    feedbackSection.style.display = 'block';
                    feedbackText.textContent = data.ai_feedback;
                }

                // AI Program Data
                if (data.target_calories) {
                    document.getElementById('val-calories').textContent = data.target_calories;
                    document.getElementById('val-protein').textContent = `${data.protein_grams}g`;
                    document.getElementById('val-carbs').textContent = `${data.carbs_grams}g`;
                    document.getElementById('val-fats').textContent = `${data.fats_grams}g`;
                }

                // --- Nutrition Tracker Logic ---
                if (data.portion_budget && data.portion_bank) {
                    try {
                        const budget = JSON.parse(data.portion_budget);
                        
                        // Translation Layer
                        if (data.protein_grams && budget.protein) {
                            const gramsPerPortion = Math.round(data.protein_grams / budget.protein);
                            document.getElementById('trans-protein').textContent = `שווה ערך ל-${budget.protein} מנות (כ-${gramsPerPortion}g למנה)`;
                        }
                        if (data.carbs_grams && budget.carbs) {
                            const gramsPerPortion = Math.round(data.carbs_grams / budget.carbs);
                            document.getElementById('trans-carbs').textContent = `שווה ערך ל-${budget.carbs} מנות (כ-${gramsPerPortion}g למנה)`;
                        }
                        if (data.fats_grams && budget.fats) {
                            const gramsPerPortion = Math.round(data.fats_grams / budget.fats);
                            document.getElementById('trans-fats').textContent = `שווה ערך ל-${budget.fats} מנות (כ-${gramsPerPortion}g למנה)`;
                        }

                        // Set budget labels
                        document.querySelector('#count-carbs .budget').textContent = budget.carbs || 0;
                        document.querySelector('#count-protein .budget').textContent = budget.protein || 0;
                        document.querySelector('#count-fats .budget').textContent = budget.fats || 0;

                        document.getElementById('count-carbs').setAttribute('data-budget', budget.carbs || 0);
                        document.getElementById('count-protein').setAttribute('data-budget', budget.protein || 0);
                        document.getElementById('count-fats').setAttribute('data-budget', budget.fats || 0);

                        // LocalStorage State Management
                        const userIdStr = data.id || 'guest';
                        const storageKey = `nutrition_tracker_${userIdStr}`;
                        
                        let trackerState = JSON.parse(localStorage.getItem(storageKey)) || {
                            date: new Date().toLocaleDateString(),
                            consumed: { carbs: 0, protein: 0, fats: 0 }
                        };

                        // Auto Reset at Midnight
                        if (trackerState.date !== new Date().toLocaleDateString()) {
                            trackerState = {
                                date: new Date().toLocaleDateString(),
                                consumed: { carbs: 0, protein: 0, fats: 0 }
                            };
                            localStorage.setItem(storageKey, JSON.stringify(trackerState));
                        }

                        // Update UI with consumed amounts
                        const updateTrackerUI = () => {
                            ['carbs', 'protein', 'fats'].forEach(type => {
                                const countEl = document.getElementById(`count-${type}`);
                                if (!countEl) return;
                                
                                const consumedVal = trackerState.consumed[type];
                                const budgetVal = parseInt(countEl.getAttribute('data-budget')) || 0;
                                
                                countEl.querySelector('.consumed').textContent = consumedVal;
                                
                                if (consumedVal > budgetVal) {
                                    countEl.classList.add('over-budget');
                                } else {
                                    countEl.classList.remove('over-budget');
                                }
                            });
                        };
                        updateTrackerUI();

                        // Event Listeners for + / -
                        document.querySelectorAll('.btn-track').forEach(btn => {
                            // remove existing listener if any to avoid duplicates in case of re-render
                            const newBtn = btn.cloneNode(true);
                            btn.parentNode.replaceChild(newBtn, btn);
                            
                            newBtn.addEventListener('click', (e) => {
                                const type = e.target.getAttribute('data-type');
                                const isPlus = e.target.classList.contains('plus');
                                
                                if (isPlus) {
                                    trackerState.consumed[type]++;
                                } else {
                                    if (trackerState.consumed[type] > 0) {
                                        trackerState.consumed[type]--;
                                    }
                                }
                                
                                localStorage.setItem(storageKey, JSON.stringify(trackerState));
                                updateTrackerUI();
                            });
                        });

                        // Reset Button
                        const btnReset = document.getElementById('btn-reset-tracker');
                        if (btnReset) {
                            const newBtnReset = btnReset.cloneNode(true);
                            btnReset.parentNode.replaceChild(newBtnReset, btnReset);
                            newBtnReset.addEventListener('click', () => {
                                if(confirm('האם אתה בטוח שברצונך לאפס את המונים להיום?')) {
                                    trackerState.consumed = { carbs: 0, protein: 0, fats: 0 };
                                    localStorage.setItem(storageKey, JSON.stringify(trackerState));
                                    updateTrackerUI();
                                }
                            });
                        }

                        // Render Exchange Lists
                        const bank = JSON.parse(data.portion_bank);
                        const defs = data.portion_definitions ? JSON.parse(data.portion_definitions) : null;
                        const hebrewNames = { carbs: 'פחמימה', protein: 'חלבון', fats: 'שומן' };

                        ['carbs', 'protein', 'fats'].forEach(type => {
                            const listEl = document.getElementById(`bank-${type}`);
                            if (listEl && bank[type] && Array.isArray(bank[type])) {
                                listEl.innerHTML = '';
                                
                                // Insert tip if definition exists
                                if (defs && defs[type]) {
                                    let oldTip = listEl.parentNode.querySelector('.exchange-tip');
                                    if (oldTip) oldTip.remove();
                                    
                                    const tip = document.createElement('div');
                                    tip.className = 'exchange-tip';
                                    tip.innerHTML = `💡 <strong>רוצים מאכל שלא ברשימה?</strong><br>מנת ${hebrewNames[type]} אחת שווה לכ-${defs[type].calories} קלוריות ול-${defs[type].grams} גרם ${hebrewNames[type]}. כל מאכל שתואם לערכים אלו יכול להחליף מנה אחת מהרשימה.`;
                                    listEl.parentNode.insertBefore(tip, listEl);
                                }

                                bank[type].forEach(item => {
                                    const li = document.createElement('li');
                                    li.innerHTML = `<strong>${item.name}</strong> - ${item.amount}`;
                                    listEl.appendChild(li);
                                });
                            }
                        });

                    } catch (e) {
                        console.error('Failed to parse portion budget or bank', e);
                    }
                }

                // Parse and render Workout Plan JSON
                if (data.workout_plan) {
                    try {
                        const workoutArray = JSON.parse(data.workout_plan);
                        const workoutContainerEl = document.getElementById('workout-list-container');
                        workoutContainerEl.innerHTML = '';
                        
                        const nestedNav = document.createElement('div');
                        nestedNav.className = 'nested-tabs-nav';
                        
                        const nestedContent = document.createElement('div');
                        nestedContent.className = 'nested-tabs-content';

                        workoutArray.forEach((dayPlan, index) => {
                            // Tab Button
                            const tabBtn = document.createElement('button');
                            tabBtn.className = `nested-tab-btn ${index === 0 ? 'active' : ''}`;
                            tabBtn.textContent = dayPlan.day;
                            nestedNav.appendChild(tabBtn);

                            // Tab Pane
                            const dayBlock = document.createElement('div');
                            dayBlock.className = `nested-tab-pane ${index === 0 ? 'active' : ''}`;
                            
                            const dayTitle = document.createElement('h4');
                            dayTitle.textContent = `${dayPlan.day} - ${dayPlan.title}`;
                            dayTitle.style.color = 'var(--text-primary)';
                            dayTitle.style.marginBottom = '15px';
                            dayBlock.appendChild(dayTitle);
                            
                            const exList = document.createElement('ul');
                            exList.className = 'workout-list';
                            dayPlan.exercises.forEach(ex => {
                                const li = document.createElement('li');
                                li.innerHTML = `<strong>${ex.name}:</strong> ${ex.details}`;
                                
                                // Parse sets count from ex.details
                                let setsCount = 3; // Default
                                const setMatchHebrew = ex.details.match(/(\d+)\s*סטים/);
                                const setMatchX = ex.details.match(/(\d+)\s*(X|x)/);
                                if (setMatchHebrew && parseInt(setMatchHebrew[1]) > 0 && parseInt(setMatchHebrew[1]) <= 10) {
                                    setsCount = parseInt(setMatchHebrew[1]);
                                } else if (setMatchX && parseInt(setMatchX[1]) > 0 && parseInt(setMatchX[1]) <= 10) {
                                    setsCount = parseInt(setMatchX[1]);
                                }
                                
                                const trackingDiv = document.createElement('div');
                                trackingDiv.className = 'exercise-tracking-container';
                                trackingDiv.dataset.exName = ex.name;
                                
                                for (let s = 1; s <= setsCount; s++) {
                                    const setRow = document.createElement('div');
                                    setRow.className = 'exercise-set-row';
                                    setRow.innerHTML = `
                                        <span class="set-label">סט ${s}:</span>
                                        <input type="number" class="set-weight" placeholder="משקל (KG)" step="0.5" min="0">
                                        <input type="number" class="set-reps" placeholder="חזרות" min="0">
                                    `;
                                    trackingDiv.appendChild(setRow);
                                }
                                
                                li.appendChild(trackingDiv);
                                exList.appendChild(li);
                            });
                            dayBlock.appendChild(exList);
                            
                            // Save Button
                            const saveBtn = document.createElement('button');
                            saveBtn.className = 'btn-log-workout';
                            saveBtn.textContent = 'סיים אימון ושמור נתונים';
                            saveBtn.addEventListener('click', async () => {
                                const trackingContainers = dayBlock.querySelectorAll('.exercise-tracking-container');
                                const exercisesLogged = [];
                                
                                trackingContainers.forEach(container => {
                                    const name = container.dataset.exName;
                                    const setRows = container.querySelectorAll('.exercise-set-row');
                                    const setsData = [];
                                    
                                    setRows.forEach((row, index) => {
                                        const weight = row.querySelector('.set-weight').value;
                                        const reps = row.querySelector('.set-reps').value;
                                        
                                        if (weight || reps) {
                                            setsData.push({
                                                setNum: index + 1,
                                                weight: parseFloat(weight) || 0,
                                                reps: parseInt(reps) || 0
                                            });
                                        }
                                    });
                                    
                                    if (setsData.length > 0) {
                                        exercisesLogged.push({ name, sets: setsData });
                                    }
                                });
                                
                                if (exercisesLogged.length === 0) {
                                    alert('אנא הזן נתונים לפחות לסט אחד לפני השמירה.');
                                    return;
                                }

                                saveBtn.disabled = true;
                                saveBtn.textContent = 'שומר נתונים...';

                                const payload = {
                                    workoutData: {
                                        date: new Date().toISOString(),
                                        workout_day: dayPlan.day,
                                        workout_title: dayPlan.title,
                                        exercises: exercisesLogged
                                    }
                                };

                                try {
                                    const res = await fetch('/api/log-workout', {
                                        method: 'POST',
                                        headers: { 
                                            'Content-Type': 'application/json',
                                            'Authorization': `Bearer ${token}`
                                        },
                                        body: JSON.stringify(payload)
                                    });
                                    
                                    if (res.ok) {
                                        saveBtn.classList.add('success');
                                        saveBtn.textContent = '✓ אימון נשמר בהצלחה!';
                                        setTimeout(() => {
                                            saveBtn.classList.remove('success');
                                            saveBtn.textContent = 'סיים אימון ושמור נתונים';
                                            saveBtn.disabled = false;
                                            
                                            // Clear inputs for next time
                                            trackingContainers.forEach(container => {
                                                const setRows = container.querySelectorAll('.exercise-set-row');
                                                setRows.forEach(row => {
                                                    row.querySelector('.set-weight').value = '';
                                                    row.querySelector('.set-reps').value = '';
                                                });
                                            });
                                        }, 3000);
                                    } else {
                                        const err = await res.json();
                                        alert('שגיאה בשמירה: ' + (err.error || 'נסה שוב'));
                                        saveBtn.disabled = false;
                                        saveBtn.textContent = 'סיים אימון ושמור נתונים';
                                    }
                                } catch(err) {
                                    alert('שגיאת תקשורת מול השרת');
                                    saveBtn.disabled = false;
                                    saveBtn.textContent = 'סיים אימון ושמור נתונים';
                                }
                            });
                            dayBlock.appendChild(saveBtn);
                            
                            nestedContent.appendChild(dayBlock);

                            // Tab Switching Logic
                            tabBtn.addEventListener('click', () => {
                                Array.from(nestedNav.children).forEach(c => c.classList.remove('active'));
                                Array.from(nestedContent.children).forEach(c => c.classList.remove('active'));
                                tabBtn.classList.add('active');
                                dayBlock.classList.add('active');
                            });
                        });
                        
                        workoutContainerEl.appendChild(nestedNav);
                        workoutContainerEl.appendChild(nestedContent);
                    } catch (e) {
                        console.error('Failed to parse workout plan', e);
                    }
                }

                // Parse and render Cardio & NEAT
                if (data.cardio_and_neat) {
                    try {
                        const cardioObj = JSON.parse(data.cardio_and_neat);
                        document.getElementById('cardio-card').style.display = 'block';
                        document.getElementById('val-steps').textContent = cardioObj.dailyStepsTarget || '--';
                        document.getElementById('val-cardio-desc').textContent = cardioObj.weeklyCardio || '--';
                    } catch (e) {
                        console.error('Failed to parse cardio and neat', e);
                    }
                }

        } else {
            // Unauthenticated or not found
            localStorage.removeItem('token');
            window.location.replace('index.html');
        }
    } catch (error) {
        console.error('Network error', error);
    }

    // Modal Logic
    const modal = document.getElementById('checkin-modal');
    const btnCancel = document.getElementById('btn-cancel-checkin');
    const checkinForm = document.getElementById('checkin-form');
    const btnSubmitCheckin = document.getElementById('btn-submit-checkin');

    btnUpdate.addEventListener('click', () => {
        modal.style.display = 'flex';
    });

    btnCancel.addEventListener('click', () => {
        modal.style.display = 'none';
        checkinForm.reset();
    });

    // File inputs visual feedback in modal
    const fileInputs = checkinForm.querySelectorAll('input[type="file"]');
    fileInputs.forEach(input => {
        input.addEventListener('change', function() {
            const box = this.parentElement;
            const span = box.querySelector('span');
            if (this.files && this.files.length > 0) {
                box.classList.add('has-file');
                span.textContent = 'נבחרה ✓';
            } else {
                box.classList.remove('has-file');
                span.textContent = 'העלאה';
            }
        });
    });

    checkinForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        btnSubmitCheckin.disabled = true;
        btnSubmitCheckin.textContent = 'מעדכן נתונים...';

        try {
            const formData = new FormData(checkinForm);
            const response = await fetch('/api/checkin', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`
                },
                body: formData
            });

            let result;
            const textResponse = await response.text();
            try {
                result = JSON.parse(textResponse);
            } catch (err) {
                console.error("Raw response from server:", textResponse);
                throw new Error("השרת החזיר תשובה שאינה תקינה (אולי השרת לא הופעל מחדש או שיש שגיאת קוד): " + textResponse.substring(0, 100));
            }

            if (response.ok) {
                alert('המעקב עבר בהצלחה! ה-AI עדכן את התוכנית שלך.');
                window.location.reload(); 
            } else {
                alert('שגיאה: ' + (result.error || 'אירעה בעיה'));
            }
        } catch (error) {
            console.error(error);
            alert('שגיאת תקשורת עם השרת: ' + error.message);
        } finally {
            btnSubmitCheckin.disabled = false;
            btnSubmitCheckin.textContent = 'שלח עדכון ל-AI';
        }
    });

    // Tabs Logic
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabPanes = document.querySelectorAll('.tab-pane');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            tabPanes.forEach(p => p.classList.remove('active'));

            btn.classList.add('active');
            const targetId = btn.getAttribute('data-target');
            document.getElementById(targetId).classList.add('active');
        });
    });

    // Logout
    const btnLogout = document.getElementById('btn-logout');
    if (btnLogout) {
        btnLogout.addEventListener('click', () => {
            localStorage.removeItem('token');
            window.location.replace('index.html');
        });
    }

    // PDF Export Logic
    const getPdfConfig = (filename) => ({
        margin: 15,
        filename: filename,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    });

    const btnExportNutrition = document.getElementById('btn-export-nutrition');
    if (btnExportNutrition) {
        btnExportNutrition.addEventListener('click', () => {
            const originalText = btnExportNutrition.innerHTML;
            btnExportNutrition.innerHTML = 'מייצר PDF...';
            
            const element = document.querySelector('.nutrition-card');
            element.classList.add('pdf-exporting');
            
            html2pdf().set(getPdfConfig('nutrition-plan.pdf')).from(element).save().then(() => {
                element.classList.remove('pdf-exporting');
                btnExportNutrition.innerHTML = originalText;
            });
        });
    }

    const btnExportWorkout = document.getElementById('btn-export-workout');
    if (btnExportWorkout) {
        btnExportWorkout.addEventListener('click', () => {
            const originalText = btnExportWorkout.innerHTML;
            btnExportWorkout.innerHTML = 'מייצר PDF...';
            
            const element = document.getElementById('tab-workout');
            const allPanes = element.querySelectorAll('.nested-tab-pane');
            
            // Show all workout days for export
            allPanes.forEach(p => {
                p.style.display = 'block';
                p.style.opacity = '1';
                p.style.animation = 'none';
            });
            
            element.classList.add('pdf-exporting');
            
            html2pdf().set(getPdfConfig('workout-plan.pdf')).from(element).save().then(() => {
                // Restore UI state
                allPanes.forEach(p => {
                    p.style.display = '';
                    p.style.opacity = '';
                    p.style.animation = '';
                });
                element.classList.remove('pdf-exporting');
                btnExportWorkout.innerHTML = originalText;
            });
        });
    }
});
