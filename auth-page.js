const API_BASE = `${window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1" ? "http://localhost:5000/api" : "/api"}/auth`;

const showAlert = (alertBox, msg, type) => {
  if (!alertBox) return;
  alertBox.innerText = msg;
  alertBox.className = `p-3 mb-4 text-xs rounded border ${
    type === "error"
      ? "border-red-900/60 bg-red-950/40 text-red-300"
      : "border-green-900/60 bg-green-950/40 text-green-300"
  }`;
  alertBox.classList.remove("hidden");
};

document.addEventListener("DOMContentLoaded", () => {
  localStorage.removeItem("debsoc_token");
  const form = document.getElementById("register-form");
  const alertBox = document.getElementById("auth-alert");
  const pageTitle = document.getElementById("page-title");
  const pageSubtitle = document.getElementById("page-subtitle");
  const submitBtn = document.getElementById("submit-btn");
  const toggleBtn = document.getElementById("toggle-mode-btn");
  const toggleText = document.getElementById("toggle-text");
  const nameField = document.getElementById("field-displayName");
  const userField = document.getElementById("field-username");
  const otpField = document.getElementById("field-otp");
  const displayNameInput = document.getElementById("reg-displayName");
  const usernameInput = document.getElementById("reg-username");
  const emailInput = document.getElementById("reg-email");
  const passwordInput = document.getElementById("reg-password");
  const otpInput = document.getElementById("reg-otp");

  if (!form || !alertBox || !submitBtn || !toggleBtn || !emailInput || !passwordInput) {
    return;
  }

  let isRegisterMode = true;
  let isAwaitingOtp = false;
  let pendingEmail = "";

  const setButtonText = (text, disabled = false) => {
    submitBtn.disabled = disabled;
    submitBtn.innerText = text;
  };

  const resetOtpState = () => {
    isAwaitingOtp = false;
    pendingEmail = "";
    if (otpField) otpField.classList.add("hidden");
    if (otpInput) otpInput.value = "";
  };

  const toggleMode = () => {
    isRegisterMode = !isRegisterMode;
    alertBox.classList.add("hidden");
    resetOtpState();

    if (isRegisterMode) {
      pageTitle.innerText = "Create Account";
      pageSubtitle.innerText = "Use your personal or institutional email address.";
      setButtonText("Complete Registration", false);
      toggleText.innerText = "Already registered?";
      toggleBtn.innerText = "Sign In";
      if (nameField) nameField.classList.remove("hidden");
      if (userField) userField.classList.remove("hidden");
      if (displayNameInput) displayNameInput.required = true;
      if (usernameInput) usernameInput.required = true;
    } else {
      pageTitle.innerText = "Sign In";
      pageSubtitle.innerText = "Access your DebSoc profile and debate registrations.";
      setButtonText("Sign In", false);
      toggleText.innerText = "Need an account?";
      toggleBtn.innerText = "Register";
      if (nameField) nameField.classList.add("hidden");
      if (userField) userField.classList.add("hidden");
      if (displayNameInput) displayNameInput.required = false;
      if (usernameInput) usernameInput.required = false;
    }
  };

  toggleBtn.addEventListener("click", toggleMode);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    alertBox.classList.add("hidden");

    const email = emailInput.value.trim();
    const password = passwordInput.value;

    if (isAwaitingOtp) {
      const otp = (otpInput?.value || "").trim();
      if (!otp) {
        showAlert(alertBox, "Please enter the 6-digit OTP sent to your email.", "error");
        return;
      }

      setButtonText("Verifying OTP...", true);

      try {
        const res = await fetch(`${API_BASE}/verify-otp`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ email: pendingEmail, otp })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Verification failed");

        localStorage.setItem("debsoc_user", JSON.stringify(data.user));

        showAlert(alertBox, "Verification successful! Redirecting...", "success");
        setTimeout(() => {
          window.location.href = "index.html";
        }, 800);
      } catch (err) {
        showAlert(alertBox, err.message, "error");
      } finally {
        setButtonText("Verify OTP", false);
      }
      return;
    }

    const isLoginMode = !isRegisterMode;
    setButtonText(isLoginMode ? "Signing In..." : "Sending OTP...", true);

    try {
      const endpoint = isLoginMode ? `${API_BASE}/login` : `${API_BASE}/register`;
      const payload = isLoginMode
        ? { email, password }
        : {
            displayName: displayNameInput.value.trim(),
            username: usernameInput.value.trim(),
            email,
            password
          };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Authentication failed.");

      if (isLoginMode) {
        localStorage.setItem("debsoc_user", JSON.stringify(data.user));

        showAlert(alertBox, "Login successful! Redirecting...", "success");
        setTimeout(() => {
          window.location.href = "index.html";
        }, 800);
      } else {
        pendingEmail = email;
        isAwaitingOtp = true;
        if (otpField) otpField.classList.remove("hidden");
        if (otpInput) otpInput.focus();
        setButtonText("Verify OTP", false);
        showAlert(alertBox, "OTP sent to your email. Enter the code to finish registration.", "success");
      }
    } catch (err) {
      showAlert(alertBox, err.message, "error");
    } finally {
      if (isLoginMode) {
        setButtonText("Sign In", false);
      }
      if (!isLoginMode && !isAwaitingOtp) {
        setButtonText("Complete Registration", false);
      }
    }
  });
});