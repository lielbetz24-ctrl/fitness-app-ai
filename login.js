document.addEventListener('DOMContentLoaded', () => {
    // Redirect to dashboard if already logged in
    if (localStorage.getItem('token')) {
        window.location.href = 'dashboard.html';
        return;
    }

    let isLogin = true;
    
    const formTitle = document.getElementById('form-title');
    const submitBtn = document.getElementById('submit-btn');
    const toggleMode = document.getElementById('toggle-mode');
    const authForm = document.getElementById('auth-form');
    const errorMessage = document.getElementById('error-message');

    toggleMode.addEventListener('click', () => {
        isLogin = !isLogin;
        if (isLogin) {
            formTitle.textContent = 'התחברות';
            submitBtn.textContent = 'היכנס';
            toggleMode.textContent = 'אין לך חשבון? הירשם כאן';
        } else {
            formTitle.textContent = 'הרשמה';
            submitBtn.textContent = 'צור חשבון';
            toggleMode.textContent = 'כבר יש לך חשבון? היכנס כאן';
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
                // If registering, go to onboarding. If logging in, go to dashboard.
                window.location.href = isLogin ? 'dashboard.html' : 'index.html';
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
