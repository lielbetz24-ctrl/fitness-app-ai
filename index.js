document.addEventListener('DOMContentLoaded', () => {
    const token = localStorage.getItem('token');
    const authForm = document.getElementById('auth-form');
    const toggleMode = document.getElementById('toggle-mode');
    const loadingSpinner = document.getElementById('loading-spinner');

    if (token) {
        if (authForm) authForm.style.display = 'none';
        if (toggleMode) toggleMode.style.display = 'none';
        if (loadingSpinner) loadingSpinner.style.display = 'block';

        (async () => {
            try {
                const res = await fetch('/api/user/me', {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                
                if (res.ok) {
                    const data = await res.json();
                    if (data.isOnboardingCompleted) {
                        window.location.replace('dashboard.html');
                    } else {
                        window.location.replace('onboarding.html');
                    }
                    return;
                }
            } catch (e) {
                console.error("Token validation failed", e);
            }
            
            localStorage.removeItem('token');
            if (loadingSpinner) loadingSpinner.style.display = 'none';
            if (authForm) authForm.style.display = 'flex';
            if (toggleMode) toggleMode.style.display = 'block';
        })();
        return;
    }

    let isLogin = true;
    
    const formTitle = document.getElementById('form-title');
    const formSubtitle = document.getElementById('form-subtitle');
    const submitBtn = document.getElementById('submit-btn');
    const errorMessage = document.getElementById('error-message');

    toggleMode.addEventListener('click', () => {
        isLogin = !isLogin;
        if (isLogin) {
            formTitle.textContent = 'ברוך הבא';
            formSubtitle.textContent = 'התחבר לחשבון שלך למערכת הכושר';
            submitBtn.textContent = 'היכנס';
            toggleMode.innerHTML = 'עוד לא רשום?<span>צור חשבון כאן</span>';
        } else {
            formTitle.textContent = 'צור חשבון חדש';
            formSubtitle.textContent = 'הירשם והתחל לבנות את תוכנית האימונים שלך';
            submitBtn.textContent = 'הרשם עכשיו';
            toggleMode.innerHTML = 'כבר יש לך חשבון?<span>היכנס כאן</span>';
        }
        errorMessage.style.display = 'none';
    });

    authForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        const endpoint = isLogin ? '/api/auth/login' : '/api/auth/register';
        
        submitBtn.disabled = true;
        submitBtn.textContent = 'טוען...';
        errorMessage.style.display = 'none';

        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            
            const data = await response.json();
            
            if (response.ok) {
                // Save token and navigate
                localStorage.setItem('token', data.token);
                if (data.isOnboardingCompleted) {
                    window.location.href = 'dashboard.html';
                } else {
                    window.location.href = 'index.html';
                }
            } else {
                errorMessage.textContent = data.error || 'שגיאה כלשהי אירעה';
                errorMessage.style.display = 'block';
            }
        } catch (err) {
            errorMessage.textContent = 'שגיאת רשת. נסה שוב מאוחר יותר.';
            errorMessage.style.display = 'block';
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = isLogin ? 'היכנס' : 'צור חשבון';
        }
    });
});
