document.addEventListener('DOMContentLoaded', () => {
    const token = localStorage.getItem('token');
    if (!token) {
        window.location.href = 'login.html';
        return;
    }

    const steps = document.querySelectorAll('.wizard-step');
    const stepIndicators = document.querySelectorAll('.step');
    const progressBar = document.getElementById('progress-bar');
    const btnNext = document.getElementById('btn-next');
    const btnPrev = document.getElementById('btn-prev');
    
    let currentStep = 0;
    const totalSteps = steps.length;

    function updateWizard() {
        steps.forEach((step, index) => {
            step.classList.toggle('active', index === currentStep);
        });

        stepIndicators.forEach((indicator, index) => {
            if (index <= currentStep) {
                indicator.classList.add('active');
            } else {
                indicator.classList.remove('active');
            }
        });

        const progressPercentage = (currentStep / (totalSteps - 1)) * 100;
        progressBar.style.width = `${progressPercentage}%`;

        btnPrev.disabled = currentStep === 0;
        
        if (currentStep === totalSteps - 1) {
            btnNext.textContent = 'סיום ושמירה';
        } else {
            btnNext.textContent = 'הבא';
        }
    }

    function validateStep() {
        const currentStepEl = steps[currentStep];
        const inputs = currentStepEl.querySelectorAll('input[required], select[required]');
        let isValid = true;

        inputs.forEach(input => {
            if (!input.value) {
                isValid = false;
                input.style.borderColor = 'var(--error-color)';
            } else {
                input.style.borderColor = 'var(--border-color)';
            }
        });

        return isValid;
    }

    btnNext.addEventListener('click', async () => {
        if (currentStep < totalSteps - 1) {
            if (validateStep()) {
                currentStep++;
                updateWizard();
            }
        } else {
            if (validateStep()) {
                // Collect form data and disable button
                btnNext.disabled = true;
                btnNext.textContent = 'שומר נתונים...';

                try {
                    const form = document.getElementById('onboarding-form');
                    const formData = new FormData(form);

                    // Send data to the Express backend
                    const response = await fetch('/api/onboarding', {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${token}`
                        },
                        body: formData // Fetch API automatically sets Content-Type to multipart/form-data with bounds
                    });

                    const result = await response.json();

                    if (response.ok) {
                        // Redirect automatically to the new Dashboard
                        window.location.href = '/dashboard.html';
                    } else {
                        alert('שגיאה: ' + (result.error || 'אירעה בעיה בשמירת הנתונים.'));
                    }
                } catch (error) {
                    console.error('Submission error:', error);
                    alert('שגיאת תקשורת. אנא ודא שהשרת פועל.');
                } finally {
                    btnNext.disabled = false;
                    btnNext.textContent = 'סיום ושמירה';
                }
            }
        }
    });

    btnPrev.addEventListener('click', () => {
        if (currentStep > 0) {
            currentStep--;
            updateWizard();
        }
    });

    // File inputs visual feedback
    const fileInputs = document.querySelectorAll('input[type="file"]');
    fileInputs.forEach(input => {
        input.addEventListener('change', function() {
            const box = this.parentElement;
            const span = box.querySelector('span');
            if (this.files && this.files.length > 0) {
                box.classList.add('has-file');
                span.textContent = 'תמונה נבחרה ✓';
            } else {
                box.classList.remove('has-file');
                span.textContent = 'העלאת תמונה';
            }
        });
    });

    // Remove red border on input
    const allInputs = document.querySelectorAll('input, select');
    allInputs.forEach(input => {
        input.addEventListener('input', function() {
            if (this.value) {
                this.style.borderColor = 'var(--border-color)';
            }
        });
    });

    updateWizard();
});
