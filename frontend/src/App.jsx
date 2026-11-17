import { useEffect, useRef, useState } from 'react'
import {
  onAuthStateChanged,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  signOut,
} from '@firebase/auth'
import { auth } from './firebase'
import './App.css'

const countryOptions = [
  { callingCode: '+91', name: 'India' },
  { callingCode: '+1', name: 'United States' },
]

const firebaseErrorMessages = {
  'auth/invalid-phone-number': 'Enter a valid phone number.',
  'auth/invalid-verification-code': 'That code is incorrect. Check it and try again.',
  'auth/code-expired': 'That code has expired. Request a new one.',
  'auth/too-many-requests': 'Too many attempts. Please wait before trying again.',
  'auth/quota-exceeded': 'SMS verification is temporarily unavailable. Please try again later.',
  'auth/captcha-check-failed': 'The security check failed. Please try again.',
  'auth/invalid-app-credential': 'The security check expired. Please request a new code.',
  'auth/operation-not-allowed': 'Phone sign-in is not enabled for this Firebase project.',
  'auth/app-not-authorized': 'This domain is not authorized for Firebase phone sign-in.',
  'auth/network-request-failed': 'Check your internet connection and try again.',
}

function getFirebaseErrorMessage(error, fallback) {
  const errorCode = typeof error?.code === 'string' ? error.code : 'unknown'
  return firebaseErrorMessages[errorCode] || `${fallback} (Firebase error: ${errorCode}).`
}

const benefits = [
  {
    number: '01',
    title: 'Bookings, beautifully organized',
    description: 'Keep every reservation right where you need it.',
  },
  {
    number: '02',
    title: 'A calmer day at the front desk',
    description: 'Spend less time juggling, more time welcoming.',
  },
  {
    number: '03',
    title: 'Your hotel, your pace',
    description: 'Set up the details whenever you’re ready.',
  },
]

function BrandMark() {
  return (
    <a className="brand" href="#" aria-label="Haven home">
      <span className="brand-icon" aria-hidden="true">
        <svg viewBox="0 0 32 32" fill="none">
          <path d="M5 26V12.5L16 5l11 7.5V26H5Z" />
          <path d="M12 26v-8h8v8M10 13h.01M16 13h.01M22 13h.01" />
        </svg>
      </span>
      <span>haven<span className="brand-period">.</span></span>
    </a>
  )
}

function App() {
  const [countryCode, setCountryCode] = useState('+91')
  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState('')
  const [step, setStep] = useState('phone')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [user, setUser] = useState(null)
  const [isSendingCode, setIsSendingCode] = useState(false)
  const [isVerifyingCode, setIsVerifyingCode] = useState(false)
  const recaptchaContainerRef = useRef(null)
  const recaptchaVerifierRef = useRef(null)
  const confirmationResultRef = useRef(null)

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (authUser) => {
      setUser(authUser)
      setStep((currentStep) => (
        authUser ? 'complete' : currentStep === 'complete' ? 'phone' : currentStep
      ))
    })

    return () => {
      unsubscribe()
      recaptchaVerifierRef.current?.clear()
    }
  }, [])

  const sendVerificationCode = async () => {
    if (isSendingCode) return

    const digits = phone.replace(/\D/g, '')

    if (digits.length !== 10) {
      setError('Enter a valid 10-digit phone number.')
      return
    }

    setError('')
    setNotice('')
    setIsSendingCode(true)

    try {
      recaptchaVerifierRef.current?.clear()
      const verifier = new RecaptchaVerifier(auth, recaptchaContainerRef.current, {
        size: 'invisible',
      })
      recaptchaVerifierRef.current = verifier

      const confirmation = await signInWithPhoneNumber(
        auth,
        `${countryCode}${digits}`,
        verifier,
      )

      confirmationResultRef.current = confirmation
      setOtp('')
      setStep('otp')
      if (step === 'otp') setNotice('A new verification code was sent.')
    } catch (firebaseError) {
      recaptchaVerifierRef.current?.clear()
      recaptchaVerifierRef.current = null
      setError(getFirebaseErrorMessage(firebaseError, 'Could not send the verification code.'))
    } finally {
      setIsSendingCode(false)
    }
  }

  const handleSendCode = (event) => {
    event.preventDefault()
    return sendVerificationCode()
  }

  const handleCreateAccount = async (event) => {
    event.preventDefault()

    if (otp.length !== 6) {
      setError('Enter the 6-digit code to continue.')
      return
    }

    if (!confirmationResultRef.current) {
      setError('Request a new verification code before continuing.')
      setStep('phone')
      return
    }

    setError('')
    setIsVerifyingCode(true)

    try {
      const credential = await confirmationResultRef.current.confirm(otp)
      confirmationResultRef.current = null
      recaptchaVerifierRef.current?.clear()
      recaptchaVerifierRef.current = null
      setUser(credential.user)
      setStep('complete')
    } catch (firebaseError) {
      setError(getFirebaseErrorMessage(firebaseError, 'Could not verify the code.'))
    } finally {
      setIsVerifyingCode(false)
    }
  }

  const changePhoneNumber = () => {
    confirmationResultRef.current = null
    setStep('phone')
    setOtp('')
    setError('')
    setNotice('')
  }

  const handleSignOut = async () => {
    setError('')

    try {
      await signOut(auth)
      confirmationResultRef.current = null
      setPhone('')
      setOtp('')
      setNotice('')
      setStep('phone')
    } catch (firebaseError) {
      setError(getFirebaseErrorMessage(firebaseError, 'Could not sign out.'))
    }
  }

  return (
    <main className="signup-shell container-fluid p-0">
      <div className="row g-0 min-vh-100">
      <section className="story-panel col-lg-5 d-none d-lg-flex" aria-label="About Haven">
        <div className="story-top">
          <BrandMark />
          <span className="story-label">A better way to host</span>
        </div>

        <div className="story-content">
          <p className="eyebrow"><span /> MADE FOR INDEPENDENT HOTELS</p>
          <h1>Make room<br />for <em>better</em> days.</h1>
          <p className="story-description">
            The little things that make running your hotel feel a whole lot
            easier.
          </p>

          <div className="benefit-list">
            {benefits.map((benefit) => (
              <div className="benefit" key={benefit.number}>
                <span className="benefit-number">{benefit.number}</span>
                <div>
                  <h2>{benefit.title}</h2>
                  <p>{benefit.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="story-footer">
          <span className="footer-sparkle" aria-hidden="true">✳</span>
          <span>Good stays start behind the scenes.</span>
          <span className="footer-location">BUILT FOR HOSPITALITY</span>
        </div>
        <div className="story-decoration story-decoration-one" aria-hidden="true" />
        <div className="story-decoration story-decoration-two" aria-hidden="true" />
      </section>

      <section className="form-panel col-12 col-lg-7" aria-label="Create your account">
        <div className="form-top">
          <span className="mobile-brand d-lg-none"><BrandMark /></span>
          <a className="login-link" href="#login" onClick={(event) => event.preventDefault()}>
            Already have an account? <span>Log in</span>
          </a>
        </div>

        <div className="form-content">
          <div className="recaptcha-container" ref={recaptchaContainerRef} />
          {step === 'complete' ? (
            <div className="completion">
              <div className="completion-icon" aria-hidden="true">✓</div>
              <p className="form-eyebrow">PHONE VERIFIED</p>
              <h2>Your account is ready.</h2>
              <p className="form-description">
                Your admin account is now connected. You can add your hotel
                details whenever you’re ready.
              </p>
              <div className="alert alert-light success-notice" role="status">
                <strong>Signed in</strong>
                <span>{user?.phoneNumber}</span>
              </div>
              {error && <p className="form-error" role="alert">{error}</p>}
              <button className="text-button" type="button" onClick={handleSignOut}>
                Sign out
              </button>
            </div>
          ) : (
            <>
              <div className="form-heading">
                <div className="step-indicator" aria-label={`Step ${step === 'phone' ? '1' : '2'} of 2`}>
                  <span className={step === 'phone' ? 'step-active' : 'step-done'} />
                  <span className={step === 'otp' ? 'step-active' : ''} />
                  <span>STEP {step === 'phone' ? '01' : '02'} <i>/ 02</i></span>
                </div>
                <p className="form-eyebrow">{step === 'phone' ? 'LET’S GET YOU STARTED' : 'ONE QUICK CHECK'}</p>
                <h2>{step === 'phone' ? 'Your hotel starts here.' : 'Verify your number.'}</h2>
                <p className="form-description">
                  {step === 'phone'
                    ? 'Create your admin account with your phone. You can add your hotel details after.'
                    : `Enter the 6-digit code we sent to ${countryCode} ${phone}.`}
                </p>
              </div>

              {step === 'phone' ? (
                <form className="signup-form d-flex flex-column" onSubmit={handleSendCode} noValidate>
                  <label className="form-label" htmlFor="phone">Phone number</label>
                  <div className={`input-group phone-field${error ? ' field-error' : ''}`}>
                    <select
                      className="form-select form-select-sm country-select"
                      id="country-code"
                      value={countryCode}
                      aria-label="Country calling code"
                      onChange={(event) => setCountryCode(event.target.value)}
                    >
                      {countryOptions.map((option) => (
                        <option key={option.callingCode} value={option.callingCode}>
                          {option.name} ({option.callingCode})
                        </option>
                      ))}
                    </select>
                    <span className="field-divider" />
                    <input
                      className="form-control"
                      id="phone"
                      type="tel"
                      autoComplete="tel-national"
                      inputMode="tel"
                      maxLength={10}
                      placeholder="00000 00000"
                      value={phone}
                      onChange={(event) => {
                        setPhone(event.target.value)
                        setError('')
                      }}
                      aria-invalid={Boolean(error)}
                      aria-describedby={error ? 'form-error' : 'phone-hint'}
                    />
                  </div>
                  {error ? (
                    <p className="form-error" id="form-error" role="alert">{error}</p>
                  ) : (
                    <p className="field-hint" id="phone-hint">We’ll send a one-time code to verify it’s you.</p>
                  )}
                  <button className="btn btn-primary primary-button" type="submit" disabled={isSendingCode}>
                    {isSendingCode ? 'Sending code…' : 'Continue with phone'}
                    {!isSendingCode && <span aria-hidden="true">→</span>}
                  </button>
                  <p className="terms text-center">
                    By continuing, you agree to our <a href="#terms" onClick={(event) => event.preventDefault()}>Terms</a> and <a href="#privacy" onClick={(event) => event.preventDefault()}>Privacy Policy</a>.
                  </p>
                </form>
              ) : (
                <form className="signup-form d-flex flex-column" onSubmit={handleCreateAccount} noValidate>
                  <label className="form-label" htmlFor="otp">6-digit verification code</label>
                  <input
                    className={`form-control otp-field${error ? ' field-error' : ''}`}
                    id="otp"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    placeholder="· · · · · ·"
                    value={otp}
                    onChange={(event) => {
                      setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))
                      setError('')
                    }}
                    aria-invalid={Boolean(error)}
                    aria-describedby={error ? 'form-error' : undefined}
                  />
                  {error ? (
                    <p className="form-error" id="form-error" role="alert">{error}</p>
                  ) : (
                    <p className="field-hint">Enter the 6-digit code sent to your phone.</p>
                  )}
                  {notice && <p className="form-notice" role="status">{notice}</p>}
                  <button className="btn btn-primary primary-button" type="submit" disabled={isVerifyingCode}>
                    {isVerifyingCode ? 'Verifying code…' : 'Create my account'}
                    {!isVerifyingCode && <span aria-hidden="true">→</span>}
                  </button>
                  <p className="resend-prompt">
                    Didn’t get a code? <button type="button" onClick={sendVerificationCode} disabled={isSendingCode}>
                      {isSendingCode ? 'Sending…' : 'Resend code'}
                    </button>
                  </p>
                  <button className="text-button change-number" type="button" onClick={changePhoneNumber}>
                    ← Change phone number
                  </button>
                </form>
              )}

              <div className="secure-note">
                <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path d="M10 2.5 3.75 5v4.17c0 3.77 2.67 7.3 6.25 8.33 3.58-1.03 6.25-4.56 6.25-8.33V5L10 2.5Z" />
                  <path d="m7.5 10 1.67 1.67L12.92 8" />
                </svg>
                <span>Your number stays private and secure.</span>
              </div>
            </>
          )}
        </div>

        <div className="form-footer">
          <span>© 2026 Haven Hospitality</span>
          <span className="footer-dot" />
          <span>Made for the people who make a stay.</span>
        </div>
      </section>
      </div>
    </main>
  )
}

export default App
