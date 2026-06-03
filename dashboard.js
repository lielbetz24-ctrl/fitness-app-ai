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
                        
                        workoutArray.forEach(dayPlan => {
                            const dayBlock = document.createElement('div');
                            dayBlock.style.marginBottom = '20px';
                            dayBlock.style.paddingBottom = '15px';
                            dayBlock.style.borderBottom = '1px solid var(--border-color)';
                            
                            const dayTitle = document.createElement('h4');
                            dayTitle.textContent = `${dayPlan.day} - ${dayPlan.title}`;
                            dayTitle.style.color = 'var(--text-primary)';
                            dayTitle.style.marginBottom = '10px';
                            dayBlock.appendChild(dayTitle);
                            
                            const exList = document.createElement('ul');
                            exList.className = 'workout-list';
                            dayPlan.exercises.forEach(ex => {
                                const li = document.createElement('li');
                                li.innerHTML = `<strong>${ex.name}:</strong> ${ex.details}`;
                                exList.appendChild(li);
                            });
                            dayBlock.appendChild(exList);
                            workoutContainerEl.appendChild(dayBlock);
                        });
                        
                        // Remove border from last block
                        if(workoutContainerEl.lastChild) {
                            workoutContainerEl.lastChild.style.borderBottom = 'none';
                            workoutContainerEl.lastChild.style.paddingBottom = '0';
                        }
                    } catch (e) {
                        console.error('Failed to parse workout plan', e);
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
