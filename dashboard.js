document.addEventListener('DOMContentLoaded', async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const userId = urlParams.get('userId');

    const totalDays = 14;
    let daysPassed = 0; 
    let daysLeft = totalDays;
    
    const daysLeftEl = document.getElementById('days-left');
    const timerProgressEl = document.getElementById('timer-progress');
    const btnUpdate = document.getElementById('btn-update');

    daysLeftEl.textContent = daysLeft;
    setTimeout(() => { timerProgressEl.style.width = '0%'; }, 100);

    if (userId) {
        try {
            const response = await fetch(`/api/user/${userId}`);
            if (response.ok) {
                const data = await response.json();
                
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

                // Parse and render Daily Menu JSON
                if (data.daily_menu) {
                    try {
                        const menuArray = JSON.parse(data.daily_menu);
                        const menuListEl = document.getElementById('menu-list');
                        menuListEl.innerHTML = '';
                        
                        menuArray.forEach(mealObj => {
                            const li = document.createElement('li');
                            li.innerHTML = `<strong>${mealObj.meal}:</strong> ${mealObj.items}`;
                            menuListEl.appendChild(li);
                        });
                    } catch (e) {
                        console.error('Failed to parse daily menu', e);
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
                                
                                // Exercise Tracking Inputs
                                const trackingDiv = document.createElement('div');
                                trackingDiv.className = 'exercise-tracking';
                                trackingDiv.innerHTML = `
                                    <input type="hidden" class="ex-name" value="${ex.name}">
                                    <input type="number" class="ex-weight" placeholder="משקל (KG)" step="0.5" min="0">
                                    <input type="number" class="ex-reps" placeholder="חזרות" min="0">
                                `;
                                li.appendChild(trackingDiv);
                                exList.appendChild(li);
                            });
                            dayBlock.appendChild(exList);
                            
                            // Save Button
                            const saveBtn = document.createElement('button');
                            saveBtn.className = 'btn-log-workout';
                            saveBtn.textContent = 'סיים אימון ושמור נתונים';
                            saveBtn.addEventListener('click', async () => {
                                const trackingDivs = dayBlock.querySelectorAll('.exercise-tracking');
                                const exercisesLogged = [];
                                trackingDivs.forEach(div => {
                                    const name = div.querySelector('.ex-name').value;
                                    const weight = div.querySelector('.ex-weight').value;
                                    const reps = div.querySelector('.ex-reps').value;
                                    
                                    // Log if they entered either weight or reps
                                    if (weight || reps) {
                                        exercisesLogged.push({ 
                                            name, 
                                            weight: parseFloat(weight) || 0, 
                                            reps: parseInt(reps) || 0 
                                        });
                                    }
                                });
                                
                                if (exercisesLogged.length === 0) {
                                    alert('אנא הזן נתונים לפחות לתרגיל אחד לפני השמירה.');
                                    return;
                                }

                                saveBtn.disabled = true;
                                saveBtn.textContent = 'שומר נתונים...';

                                const payload = {
                                    userId: userId,
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
                                        headers: { 'Content-Type': 'application/json' },
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
                                            trackingDivs.forEach(div => {
                                                div.querySelector('.ex-weight').value = '';
                                                div.querySelector('.ex-reps').value = '';
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

            }
        } catch (error) {
            console.error('Network error', error);
        }
    }

    // Modal Logic
    const modal = document.getElementById('checkin-modal');
    const btnCancel = document.getElementById('btn-cancel-checkin');
    const checkinForm = document.getElementById('checkin-form');
    const btnSubmitCheckin = document.getElementById('btn-submit-checkin');

    btnUpdate.addEventListener('click', () => {
        document.getElementById('checkin-userId').value = userId;
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
});
