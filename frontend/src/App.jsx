import { useEffect, useRef, useState } from 'react'
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
} from '@firebase/auth'
import { auth } from './firebase'
import { ApiError, getOnboarding, saveHotel, saveProfile } from './api'
import './App.css'

const initialProfile = {
  fullName: '',
  email: '',
  role: 'Owner',
}

const initialHotel = {
  name: '',
  propertyType: 'Hotel',
  address: '',
  city: '',
  region: '',
  postalCode: '',
  country: 'India',
}

const firebaseErrorMessages = {
  'auth/email-already-in-use': 'An account already exists for this email. Try signing in instead.',
  'auth/invalid-email': 'Enter a valid email address.',
  'auth/weak-password': 'Choose a password with at least 6 characters.',
  'auth/invalid-credential': 'Email or password is incorrect.',
  'auth/invalid-login-credentials': 'Email or password is incorrect.',
  'auth/user-not-found': 'Email or password is incorrect.',
  'auth/wrong-password': 'Email or password is incorrect.',
  'auth/user-disabled': 'This account has been disabled.',
  'auth/too-many-requests': 'Too many attempts. Please wait before trying again.',
  'auth/operation-not-allowed': 'Email and password sign-in is not enabled for this Firebase project.',
  'auth/network-request-failed': 'Check your internet connection and try again.',
}

function getFirebaseErrorMessage(error, fallback) {
  if (error instanceof ApiError) return error.message
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
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [authMode, setAuthMode] = useState('signup')
  const [step, setStep] = useState('auth')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [user, setUser] = useState(null)
  const [isSubmittingAuth, setIsSubmittingAuth] = useState(false)
  const [isSendingPasswordReset, setIsSendingPasswordReset] = useState(false)
  const [isCheckingSession, setIsCheckingSession] = useState(true)
  const [isSavingProfile, setIsSavingProfile] = useState(false)
  const [isSavingHotel, setIsSavingHotel] = useState(false)
  const [profile, setProfile] = useState(initialProfile)
  const [hotel, setHotel] = useState(initialHotel)
  const [hotelId, setHotelId] = useState('')
  const authModeRef = useRef('signup')
  const pendingAuthNoticeRef = useRef('')

  useEffect(() => {
    let active = true
    const unsubscribe = onAuthStateChanged(auth, (authUser) => {
      if (!active) return

      setUser(authUser)

      if (!authUser) {
        const pendingNotice = pendingAuthNoticeRef.current
        pendingAuthNoticeRef.current = ''
        setError(pendingNotice)
        setProfile(initialProfile)
        setHotel(initialHotel)
        setHotelId('')
        setStep('auth')
        setIsCheckingSession(false)
        return
      }

      setError('')
      setIsCheckingSession(true)
      setProfile({ ...initialProfile, email: authUser.email || '' })
      setHotel(initialHotel)
      setHotelId('')

      const loadOnboarding = async () => {
        try {
          const { profile: savedProfile, hotel: savedHotel } = await getOnboarding(authUser)
          if (!active || auth.currentUser?.uid !== authUser.uid) return

          if (!savedProfile && authModeRef.current === 'login') {
            pendingAuthNoticeRef.current = 'No admin account was found for this email. Sign out and choose Create account to register.'
            await signOut(auth)
            return
          }

          if (savedProfile) {
            setProfile({
              fullName: savedProfile.fullName || '',
              email: savedProfile.email || authUser.email || '',
              role: savedProfile.role || 'Owner',
            })
          }

          if (savedHotel) {
            setHotel({
              name: savedHotel.name || '',
              propertyType: savedHotel.propertyType || 'Hotel',
              address: savedHotel.address?.street || '',
              city: savedHotel.address?.city || '',
              region: savedHotel.address?.region || '',
              postalCode: savedHotel.address?.postalCode || '',
              country: savedHotel.address?.country || 'India',
            })
            setHotelId(savedHotel.id)
            setStep('done')
            return
          }

          setStep(savedProfile ? 'hotel' : 'profile')
        } catch (loadError) {
          if (!active || auth.currentUser?.uid !== authUser.uid) return
          const message = getFirebaseErrorMessage(loadError, 'Could not load your saved setup.')

          if (authModeRef.current === 'login') {
            pendingAuthNoticeRef.current = message
            try {
              await signOut(auth)
            } catch (signOutError) {
              pendingAuthNoticeRef.current = ''
              setError(`${message} ${getFirebaseErrorMessage(signOutError, 'Could not sign out.')}`)
              setStep('auth')
              setIsCheckingSession(false)
            }
          } else {
            setError(message)
            setStep('profile')
          }
        } finally {
          if (active && auth.currentUser?.uid === authUser.uid) {
            setIsCheckingSession(false)
          }
        }
      }

      loadOnboarding()
    })

    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  const handleAuthSubmit = async (event) => {
    event.preventDefault()
    const email = authEmail.trim().toLowerCase()

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('Enter a valid email address.')
      return
    }

    if (authPassword.length < 6) {
      setError('Enter a password with at least 6 characters.')
      return
    }

    if (authMode === 'signup' && authPassword !== confirmPassword) {
      setError('Your passwords do not match.')
      return
    }

    setError('')
    setNotice('')
    setIsSubmittingAuth(true)

    try {
      const credential = authMode === 'signup'
        ? await createUserWithEmailAndPassword(auth, email, authPassword)
        : await signInWithEmailAndPassword(auth, email, authPassword)

      setUser(credential.user)
      setAuthEmail(credential.user.email || email)
      setAuthPassword('')
      setConfirmPassword('')
      if (authMode === 'signup') setStep('profile')
    } catch (firebaseError) {
      setError(getFirebaseErrorMessage(firebaseError, 'Could not authenticate your account.'))
    } finally {
      setIsSubmittingAuth(false)
    }
  }

  const handlePasswordReset = async () => {
    const email = authEmail.trim().toLowerCase()

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('Enter your account email address first.')
      return
    }

    setError('')
    setNotice('')
    setIsSendingPasswordReset(true)

    try {
      await sendPasswordResetEmail(auth, email)
      setNotice('If an account exists for that email, a password reset link has been sent.')
    } catch (firebaseError) {
      setError(getFirebaseErrorMessage(firebaseError, 'Could not send a password reset email.'))
    } finally {
      setIsSendingPasswordReset(false)
    }
  }

  const handleSaveProfile = async (event) => {
    event.preventDefault()

    if (!user) {
      setError('Sign in again before saving your profile.')
      return
    }

    const fullName = profile.fullName.trim()
    const email = user.email || ''

    if (fullName.length < 2) {
      setError('Enter your full name.')
      return
    }

    if (!email) {
      setError('Your Firebase account must have an email address.')
      return
    }

    setError('')
    setIsSavingProfile(true)

    try {
      await saveProfile(user, {
        fullName,
        role: profile.role,
      })
      setProfile((currentProfile) => ({ ...currentProfile, fullName, email }))
      setStep('hotel')
    } catch (saveError) {
      setError(getFirebaseErrorMessage(saveError, 'Could not save your profile.'))
    } finally {
      setIsSavingProfile(false)
    }
  }

  const handleSaveHotel = async (event) => {
    event.preventDefault()

    if (!user) {
      setError('Sign in again before saving your hotel.')
      return
    }

    const name = hotel.name.trim()
    const street = hotel.address.trim()
    const city = hotel.city.trim()

    if (!name || !street || !city) {
      setError('Enter the hotel name, street address, and city.')
      return
    }

    setError('')
    setIsSavingHotel(true)

    try {
      const savedHotel = await saveHotel(user, {
        id: hotelId || undefined,
        name,
        propertyType: hotel.propertyType,
        address: {
          street,
          city,
          region: hotel.region.trim(),
          postalCode: hotel.postalCode.trim(),
          country: hotel.country,
        },
      })
      setHotelId(savedHotel.id)
      setStep('done')
    } catch (saveError) {
      setError(getFirebaseErrorMessage(saveError, 'Could not save your hotel details.'))
    } finally {
      setIsSavingHotel(false)
    }
  }

  const updateProfile = (field) => (event) => {
    setProfile((currentProfile) => ({
      ...currentProfile,
      [field]: event.target.value,
    }))
    setError('')
  }

  const updateHotel = (field) => (event) => {
    setHotel((currentHotel) => ({
      ...currentHotel,
      [field]: event.target.value,
    }))
    setError('')
  }

  const switchAuthMode = (nextMode) => {
    authModeRef.current = nextMode
    setAuthMode(nextMode)
    setAuthPassword('')
    setConfirmPassword('')
    setError('')
    setNotice('')
    setStep('auth')
  }

  const handleSignOut = async () => {
    setError('')

    try {
      await signOut(auth)
      setAuthPassword('')
      setConfirmPassword('')
      setNotice('')
      setError('')
      setProfile(initialProfile)
      setHotel(initialHotel)
      setHotelId('')
      setStep('auth')
    } catch (firebaseError) {
      setError(getFirebaseErrorMessage(firebaseError, 'Could not sign out.'))
    }
  }

  const currentStepNumber = step === 'auth' ? 1 : step === 'profile' ? 2 : 3

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

      <section className="form-panel col-12 col-lg-7" aria-label="Sign in or create your account">
        <div className="form-top">
          <span className="mobile-brand d-lg-none"><BrandMark /></span>
          {user ? (
            <button className="text-button header-signout" type="button" onClick={handleSignOut}>
              Sign out
            </button>
          ) : (
            <button
              className="login-link mode-switch"
              type="button"
              onClick={() => switchAuthMode(authMode === 'signup' ? 'login' : 'signup')}
            >
              {authMode === 'signup'
                ? <>Already have an account? <span>Log in</span></>
                : <>New to Haven? <span>Create account</span></>}
            </button>
          )}
        </div>

        <div className="form-content">
          {isCheckingSession ? (
            <div className="completion text-center" role="status" aria-live="polite">
              <span className="spinner-border onboarding-spinner" aria-hidden="true" />
              <p className="form-description mt-3">Loading your saved setup…</p>
            </div>
          ) : step === 'done' ? (
            <div className="completion">
              <div className="completion-icon" aria-hidden="true">✓</div>
              <p className="form-eyebrow">SETUP COMPLETE</p>
              <h2>Your hotel is ready.</h2>
              <p className="form-description">
                Your admin profile and hotel details have been saved securely.
              </p>
              <div className="alert alert-light success-notice" role="status">
                <strong>{hotel.name}</strong>
                <span>{hotel.address}, {hotel.city}, {hotel.country}</span>
                <span>{user?.email}</span>
              </div>
              {error && <p className="form-error" role="alert">{error}</p>}
              <button className="text-button" type="button" onClick={() => setStep('hotel')}>
                Update hotel details
              </button>
            </div>
          ) : (
            <>
              {step !== 'auth' && user && (
                <div className="signed-in-note">
                  Signed in as <strong>{user.email}</strong>
                </div>
              )}

              <div className="form-heading">
                <div className="step-indicator" aria-label={`Step ${currentStepNumber} of 3`}>
                  {[1, 2, 3].map((number) => (
                    <span
                      key={number}
                      className={number === currentStepNumber ? 'step-active' : number < currentStepNumber ? 'step-done' : ''}
                    />
                  ))}
                  <span>STEP 0{currentStepNumber} <i>/ 03</i></span>
                </div>
                <p className="form-eyebrow">
                  {step === 'auth'
                    ? authMode === 'signup' ? 'LET’S GET YOU STARTED' : 'WELCOME BACK'
                    : step === 'profile' ? 'YOUR ADMIN PROFILE' : 'YOUR PROPERTY'}
                </p>
                <h2>
                  {step === 'auth'
                    ? authMode === 'signup' ? 'Your hotel starts here.' : 'Welcome back.'
                    : step === 'profile'
                      ? 'Tell us about yourself.'
                      : 'Tell us about your hotel.'}
                </h2>
                <p className="form-description">
                  {step === 'auth'
                    ? authMode === 'signup'
                      ? 'Create your admin account with your email and password. Add your hotel details next.'
                      : 'Sign in securely with the email and password on your admin account.'
                    : step === 'profile'
                      ? 'Add your basic details so we can set up your hotel admin profile.'
                      : 'Add the essentials now. You can complete the rest of your property setup later.'}
                </p>
              </div>

              {step === 'auth' ? (
                <form className="signup-form d-flex flex-column" onSubmit={handleAuthSubmit} noValidate>
                  <label className="form-label" htmlFor="auth-email">Email address</label>
                  <input
                    className={`form-control onboarding-control${error ? ' field-error' : ''}`}
                    id="auth-email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@hotel.com"
                    value={authEmail}
                    onChange={(event) => {
                      setAuthEmail(event.target.value)
                      setError('')
                      setNotice('')
                    }}
                    aria-invalid={Boolean(error)}
                    required
                  />
                  <label className="form-label onboarding-label" htmlFor="auth-password">Password</label>
                  <input
                    className={`form-control onboarding-control${error ? ' field-error' : ''}`}
                    id="auth-password"
                    type="password"
                    autoComplete={authMode === 'signup' ? 'new-password' : 'current-password'}
                    placeholder={authMode === 'signup' ? 'At least 6 characters' : 'Your password'}
                    value={authPassword}
                    onChange={(event) => {
                      setAuthPassword(event.target.value)
                      setError('')
                    }}
                    aria-invalid={Boolean(error)}
                    required
                  />
                  {authMode === 'signup' ? (
                    <>
                      <label className="form-label onboarding-label" htmlFor="confirm-password">Confirm password</label>
                      <input
                        className={`form-control onboarding-control${error ? ' field-error' : ''}`}
                        id="confirm-password"
                        type="password"
                        autoComplete="new-password"
                        placeholder="Re-enter your password"
                        value={confirmPassword}
                        onChange={(event) => {
                          setConfirmPassword(event.target.value)
                          setError('')
                        }}
                        aria-invalid={Boolean(error)}
                        required
                      />
                    </>
                  ) : (
                    <button
                      className="text-button password-reset"
                      type="button"
                      onClick={handlePasswordReset}
                      disabled={isSendingPasswordReset}
                    >
                      {isSendingPasswordReset ? 'Sending reset email…' : 'Forgot password?'}
                    </button>
                  )}
                  {error && <p className="form-error" id="form-error" role="alert">{error}</p>}
                  {notice && <p className="form-notice" role="status">{notice}</p>}
                  <button className="btn btn-primary primary-button" type="submit" disabled={isSubmittingAuth}>
                    {isSubmittingAuth
                      ? 'Please wait…'
                      : authMode === 'signup'
                        ? 'Create account'
                        : 'Sign in'}
                    {!isSubmittingAuth && <span aria-hidden="true">→</span>}
                  </button>
                  {authMode === 'signup' && (
                    <p className="terms text-center">
                      By continuing, you agree to our <a href="#terms" onClick={(event) => event.preventDefault()}>Terms</a> and <a href="#privacy" onClick={(event) => event.preventDefault()}>Privacy Policy</a>.
                    </p>
                  )}
                </form>
              ) : step === 'profile' ? (
                <form className="signup-form d-flex flex-column" onSubmit={handleSaveProfile} noValidate>
                  <div className="account-email">
                    <span>ACCOUNT EMAIL</span>
                    <strong>{user?.email}</strong>
                  </div>
                  <label className="form-label" htmlFor="full-name">Your full name</label>
                  <input
                    className="form-control onboarding-control"
                    id="full-name"
                    type="text"
                    autoComplete="name"
                    placeholder="e.g. Alex Morgan"
                    value={profile.fullName}
                    onChange={updateProfile('fullName')}
                    required
                  />
                  <label className="form-label onboarding-label" htmlFor="role">Your role</label>
                  <select
                    className="form-select onboarding-control"
                    id="role"
                    value={profile.role}
                    onChange={updateProfile('role')}
                  >
                    <option>Owner</option>
                    <option>General manager</option>
                    <option>Front desk manager</option>
                    <option>Other</option>
                  </select>
                  {error && <p className="form-error" role="alert">{error}</p>}
                  <button className="btn btn-primary primary-button" type="submit" disabled={isSavingProfile}>
                    {isSavingProfile ? 'Saving profile…' : 'Save and continue'}
                    {!isSavingProfile && <span aria-hidden="true">→</span>}
                  </button>
                </form>
              ) : (
                <form className="signup-form d-flex flex-column" onSubmit={handleSaveHotel} noValidate>
                  <div className="row g-2">
                    <div className="col-12">
                      <label className="form-label" htmlFor="hotel-name">Hotel or property name</label>
                      <input
                        className="form-control onboarding-control"
                        id="hotel-name"
                        type="text"
                        autoComplete="organization"
                        placeholder="e.g. The Garden House"
                        value={hotel.name}
                        onChange={updateHotel('name')}
                        required
                      />
                    </div>
                    <div className="col-12">
                      <label className="form-label onboarding-label" htmlFor="property-type">Property type</label>
                      <select
                        className="form-select onboarding-control"
                        id="property-type"
                        value={hotel.propertyType}
                        onChange={updateHotel('propertyType')}
                      >
                        <option>Hotel</option>
                        <option>Resort</option>
                        <option>Guesthouse</option>
                        <option>Other</option>
                      </select>
                    </div>
                    <div className="col-12">
                      <label className="form-label onboarding-label" htmlFor="hotel-address">Street address</label>
                      <input
                        className="form-control onboarding-control"
                        id="hotel-address"
                        type="text"
                        autoComplete="street-address"
                        placeholder="Building, street, and area"
                        value={hotel.address}
                        onChange={updateHotel('address')}
                        required
                      />
                    </div>
                    <div className="col-12 col-sm-6">
                      <label className="form-label onboarding-label" htmlFor="hotel-city">City</label>
                      <input
                        className="form-control onboarding-control"
                        id="hotel-city"
                        type="text"
                        autoComplete="address-level2"
                        value={hotel.city}
                        onChange={updateHotel('city')}
                        required
                      />
                    </div>
                    <div className="col-12 col-sm-6">
                      <label className="form-label onboarding-label" htmlFor="hotel-region">State / region</label>
                      <input
                        className="form-control onboarding-control"
                        id="hotel-region"
                        type="text"
                        autoComplete="address-level1"
                        value={hotel.region}
                        onChange={updateHotel('region')}
                      />
                    </div>
                    <div className="col-12 col-sm-6">
                      <label className="form-label onboarding-label" htmlFor="hotel-postal-code">Postal code</label>
                      <input
                        className="form-control onboarding-control"
                        id="hotel-postal-code"
                        type="text"
                        autoComplete="postal-code"
                        value={hotel.postalCode}
                        onChange={updateHotel('postalCode')}
                      />
                    </div>
                    <div className="col-12 col-sm-6">
                      <label className="form-label onboarding-label" htmlFor="hotel-country">Country</label>
                      <select
                        className="form-select onboarding-control"
                        id="hotel-country"
                        autoComplete="country-name"
                        value={hotel.country}
                        onChange={updateHotel('country')}
                      >
                        <option>India</option>
                        <option>United States</option>
                      </select>
                    </div>
                  </div>
                  {error && <p className="form-error" role="alert">{error}</p>}
                  <div className="wizard-actions">
                    <button className="text-button" type="button" onClick={() => setStep('profile')}>
                      ← Back
                    </button>
                    <button className="btn btn-primary primary-button" type="submit" disabled={isSavingHotel}>
                      {isSavingHotel ? 'Saving hotel…' : 'Save hotel'}
                      {!isSavingHotel && <span aria-hidden="true">✓</span>}
                    </button>
                  </div>
                </form>
              )}

              {step === 'auth' && (
                <div className="secure-note">
                  <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                    <path d="M10 2.5 3.75 5v4.17c0 3.77 2.67 7.3 6.25 8.33 3.58-1.03 6.25-4.56 6.25-8.33V5L10 2.5Z" />
                    <path d="m7.5 10 1.67 1.67L12.92 8" />
                  </svg>
                  <span>Your password is protected by Firebase Authentication.</span>
                </div>
              )}
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
