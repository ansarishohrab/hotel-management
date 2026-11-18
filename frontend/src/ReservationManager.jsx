import { useEffect, useMemo, useState } from 'react'
import { createBooking, getBookings, updateBookingStatus } from './api'

const bookingStatuses = ['All reservations', 'Booked', 'Checked-in', 'Checked-out', 'Cancelled']

function localDateValue(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function addOneDay(value) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10)
}

function getDefaultDates() {
  const arrival = new Date()
  const departure = new Date(arrival)
  departure.setDate(departure.getDate() + 1)
  return {
    checkInDate: localDateValue(arrival),
    checkOutDate: localDateValue(departure),
  }
}

function getNightCount(checkInDate, checkOutDate) {
  const arrival = Date.parse(`${checkInDate}T00:00:00Z`)
  const departure = Date.parse(`${checkOutDate}T00:00:00Z`)
  return Math.max(0, (departure - arrival) / 86400000)
}

function formatDate(value, locale) {
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00Z`))
}

function formatTimestamp(value, locale) {
  if (!value) return ''
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value))
}

function getErrorMessage(error, fallback) {
  return error instanceof Error ? error.message : fallback
}

function getInitialForm(roomId = '') {
  return {
    roomId,
    guestName: '',
    guestEmail: '',
    guestPhone: '',
    guestCount: '1',
    ...getDefaultDates(),
  }
}

function ReservationManager({ user, rooms, locale, formatRate, initialRoomId, onRoomStatusChanged }) {
  const [bookings, setBookings] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [actionError, setActionError] = useState('')
  const [search, setSearch] = useState('')
  const [activeFilter, setActiveFilter] = useState('All reservations')
  const [isBookingOpen, setIsBookingOpen] = useState(false)
  const [bookingForm, setBookingForm] = useState(() => getInitialForm())
  const [formError, setFormError] = useState('')
  const [isSavingBooking, setIsSavingBooking] = useState(false)
  const [pendingBookingId, setPendingBookingId] = useState('')

  useEffect(() => {
    let active = true
    getBookings(user)
      .then((loadedBookings) => {
        if (!active) return
        setBookings(loadedBookings)
        setLoadError('')
      })
      .catch((error) => {
        if (active) setLoadError(getErrorMessage(error, 'Could not load reservations. Please try again.'))
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })

    return () => {
      active = false
    }
  }, [user])

  useEffect(() => {
    if (!isBookingOpen) return undefined

    const closeOnEscape = (event) => {
      if (event.key === 'Escape' && !isSavingBooking) setIsBookingOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [isBookingOpen, isSavingBooking])

  const counts = useMemo(() => ({
    total: bookings.length,
    booked: bookings.filter((booking) => booking.status === 'Booked').length,
    checkedIn: bookings.filter((booking) => booking.status === 'Checked-in').length,
  }), [bookings])

  const filteredBookings = useMemo(() => {
    const query = search.trim().toLowerCase()

    return bookings
      .filter((booking) => {
        const matchesStatus = activeFilter === 'All reservations' || booking.status === activeFilter
        const matchesSearch = !query
          || booking.guestName.toLowerCase().includes(query)
          || booking.roomNumber.toLowerCase().includes(query)
          || booking.guestEmail.toLowerCase().includes(query)
          || booking.guestPhone.toLowerCase().includes(query)
        return matchesStatus && matchesSearch
      })
      .sort((first, second) => first.checkInDate.localeCompare(second.checkInDate))
  }, [activeFilter, bookings, search])

  const selectedRoom = rooms.find((room) => room.id === bookingForm.roomId)
  const bookingTotal = selectedRoom
    ? selectedRoom.nightlyRate * getNightCount(bookingForm.checkInDate, bookingForm.checkOutDate)
    : 0

  const refreshBookings = async () => {
    setIsLoading(true)
    setLoadError('')
    try {
      setBookings(await getBookings(user))
    } catch (error) {
      setLoadError(getErrorMessage(error, 'Could not load reservations. Please try again.'))
    } finally {
      setIsLoading(false)
    }
  }

  const openBookingForm = () => {
    const bookableRooms = rooms.filter((room) => !['Cleaning', 'Maintenance'].includes(room.status))
    const preferredRoom = bookableRooms.find((room) => room.id === initialRoomId)
    setBookingForm(getInitialForm(preferredRoom?.id || bookableRooms[0]?.id || ''))
    setFormError('')
    setIsBookingOpen(true)
  }

  const updateBookingForm = (field) => (event) => {
    const value = event.target.value
    setBookingForm((current) => {
      const next = { ...current, [field]: value }
      if (field === 'checkInDate' && next.checkOutDate <= value) {
        next.checkOutDate = addOneDay(value)
      }
      return next
    })
    setFormError('')
  }

  const handleCreateBooking = async (event) => {
    event.preventDefault()
    setFormError('')

    if (bookingForm.checkOutDate <= bookingForm.checkInDate) {
      setFormError('Departure must be after arrival.')
      return
    }

    setIsSavingBooking(true)
    try {
      const booking = await createBooking(user, {
        ...bookingForm,
        guestName: bookingForm.guestName.trim(),
        guestEmail: bookingForm.guestEmail.trim(),
        guestPhone: bookingForm.guestPhone.trim(),
        guestCount: Number(bookingForm.guestCount),
      })
      setBookings((current) => [...current, booking])
      setIsBookingOpen(false)
    } catch (error) {
      setFormError(getErrorMessage(error, 'Could not save this reservation. Please try again.'))
    } finally {
      setIsSavingBooking(false)
    }
  }

  const handleStatusChange = async (booking, status) => {
    if (status === 'Cancelled' && !window.confirm(`Cancel the reservation for ${booking.guestName}?`)) return

    setPendingBookingId(booking.id)
    setActionError('')
    try {
      const updatedBooking = await updateBookingStatus(user, booking.id, status)
      setBookings((current) => current.map((item) => item.id === booking.id ? updatedBooking : item))
      if (status === 'Checked-in' || status === 'Checked-out') await onRoomStatusChanged()
    } catch (error) {
      setActionError(getErrorMessage(error, 'Could not update this reservation. Please try again.'))
    } finally {
      setPendingBookingId('')
    }
  }

  return (
    <div className="dashboard-content reservations-content">
      <div className="dashboard-heading">
        <div>
          <p className="dashboard-eyebrow">GUEST STAYS</p>
          <h1>Reservations <span>{counts.total}</span></h1>
          <p className="dashboard-subtitle">Create bookings and manage guest arrivals and departures.</p>
        </div>
        <button className="add-room-button" type="button" onClick={openBookingForm} disabled={!rooms.some((room) => !['Cleaning', 'Maintenance'].includes(room.status))}>
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
          New booking
        </button>
      </div>

      <div className="room-stat-grid reservation-stat-grid" aria-label="Reservation summary">
        <article className="room-stat-card">
          <span className="stat-icon stat-icon-green"><span className="stat-dot" /></span>
          <div><span className="stat-label">Total reservations</span><strong>{counts.total}</strong><small>All guest stays</small></div>
        </article>
        <article className="room-stat-card">
          <span className="stat-icon stat-icon-amber"><span className="reservation-status-dot booked-dot" /></span>
          <div><span className="stat-label">Upcoming</span><strong>{counts.booked}</strong><small>Awaiting check-in</small></div>
        </article>
        <article className="room-stat-card">
          <span className="stat-icon stat-icon-sage"><span className="reservation-status-dot checked-in-dot" /></span>
          <div><span className="stat-label">Currently checked in</span><strong>{counts.checkedIn}</strong><small>Guests staying now</small></div>
        </article>
        <article className="room-stat-card reservation-hint-card">
          <div><span className="stat-label">Front desk</span><strong>Arrivals &amp; departures</strong><small>Check guests in or out from any reservation.</small></div>
        </article>
      </div>

      <section className="rooms-panel" aria-labelledby="reservation-list-title">
        <div className="rooms-panel-heading">
          <div>
            <h2 id="reservation-list-title">All reservations</h2>
            <p>Guest details, stay dates, and check-in status.</p>
          </div>
          <button className="refresh-button" type="button" onClick={refreshBookings} disabled={isLoading} aria-label="Refresh reservations">
            <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M16.4 8A6.5 6.5 0 0 0 5 5.2L3.5 7M3.5 7V3.7M3.5 7h3.3M3.6 12a6.5 6.5 0 0 0 11.4 2.8l1.5-1.8m0 0v3.3m0-3.3h-3.3" />
            </svg>
          </button>
        </div>

        <div className="room-toolbar">
          <div className="room-filters" role="group" aria-label="Filter reservations by status">
            {bookingStatuses.map((status) => (
              <button
                className={activeFilter === status ? 'room-filter active' : 'room-filter'}
                key={status}
                type="button"
                onClick={() => setActiveFilter(status)}
                aria-pressed={activeFilter === status}
              >
                {status}
                {status === 'All reservations' && <span>{counts.total}</span>}
              </button>
            ))}
          </div>
          <label className="room-search">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.3" /><path d="m16 16 4.2 4.2" /></svg>
            <span className="sr-only">Search reservations</span>
            <input
              type="search"
              placeholder="Search guest or room"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <kbd>/</kbd>
          </label>
        </div>

        {actionError && <p className="reservation-action-error" role="alert">{actionError}</p>}

        {loadError ? (
          <div className="room-message room-error" role="alert">
            <span>{loadError}</span>
            <button type="button" onClick={refreshBookings}>Try again</button>
          </div>
        ) : isLoading ? (
          <div className="room-message" role="status"><span className="dashboard-spinner" aria-hidden="true" />Loading reservations…</div>
        ) : filteredBookings.length === 0 ? (
          <div className="room-empty-state">
            <span className="empty-bed-icon"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 5h16v15H4zM8 3v4m8-4v4M4 10h16" /></svg></span>
            <h3>{bookings.length === 0 ? 'No reservations yet' : 'No reservations match your search'}</h3>
            <p>{bookings.length === 0
              ? 'Create a booking to keep a guest’s stay and front-desk status in one place.'
              : 'Try a different search or reservation status.'}</p>
            {bookings.length === 0 && rooms.length > 0 && (
              <button className="add-room-button empty-add-button" type="button" onClick={openBookingForm}>
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
                Create the first booking
              </button>
            )}
          </div>
        ) : (
          <div className="room-table-wrap">
            <table className="room-table reservation-table">
              <thead>
                <tr>
                  <th scope="col">GUEST</th>
                  <th scope="col">ROOM</th>
                  <th scope="col">STAY</th>
                  <th scope="col">GUESTS</th>
                  <th scope="col">TOTAL</th>
                  <th scope="col">STATUS</th>
                  <th scope="col"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {filteredBookings.map((booking) => {
                  const nights = getNightCount(booking.checkInDate, booking.checkOutDate)
                  const isPending = pendingBookingId === booking.id
                  return (
                    <tr key={booking.id}>
                      <td>
                        <span className="booking-guest-name">{booking.guestName}</span>
                        <span className="booking-guest-contact">{booking.guestEmail || booking.guestPhone || 'Guest'}</span>
                      </td>
                      <td><span className="room-number">{booking.roomNumber}</span><span className="booking-room-type">{booking.roomType}</span></td>
                      <td>
                        <span className="booking-dates">{formatDate(booking.checkInDate, locale)} – {formatDate(booking.checkOutDate, locale)}</span>
                        <span className="booking-nights">{nights} {nights === 1 ? 'night' : 'nights'}</span>
                      </td>
                      <td><span className="guest-count">{booking.guestCount}</span></td>
                      <td><span className="room-rate">{formatRate(booking.nightlyRate * nights)}</span></td>
                      <td>
                        <span className={`room-status status-${booking.status.toLowerCase()}`}><i />{booking.status}</span>
                        {booking.checkedInAt && <span className="booking-event-time">In {formatTimestamp(booking.checkedInAt, locale)}</span>}
                        {booking.checkedOutAt && <span className="booking-event-time">Out {formatTimestamp(booking.checkedOutAt, locale)}</span>}
                      </td>
                      <td>
                        {booking.status === 'Booked' && (
                          <div className="booking-actions">
                            <button type="button" onClick={() => handleStatusChange(booking, 'Checked-in')} disabled={isPending}>
                              {isPending ? 'Saving…' : 'Check in'}
                            </button>
                            <button type="button" className="booking-cancel-action" onClick={() => handleStatusChange(booking, 'Cancelled')} disabled={isPending}>
                              Cancel
                            </button>
                          </div>
                        )}
                        {booking.status === 'Checked-in' && (
                          <button className="booking-primary-action" type="button" onClick={() => handleStatusChange(booking, 'Checked-out')} disabled={isPending}>
                            {isPending ? 'Saving…' : 'Check out'}
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <div className="room-table-footer">Showing <strong>{filteredBookings.length}</strong> of <strong>{bookings.length}</strong> reservations</div>
          </div>
        )}
      </section>

      <p className="dashboard-footnote">Reservation dates are managed per room. Cancelled reservations release those dates.</p>

      {isBookingOpen && (
        <div className="room-modal-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !isSavingBooking) setIsBookingOpen(false)
        }}>
          <section className="room-modal reservation-modal" role="dialog" aria-modal="true" aria-labelledby="new-booking-title">
            <button className="modal-close" type="button" onClick={() => setIsBookingOpen(false)} disabled={isSavingBooking} aria-label="Close dialog">×</button>
            <p className="dashboard-eyebrow">GUEST STAY</p>
            <h2 id="new-booking-title">New booking</h2>
            <p className="modal-description">Choose a room and add the guest’s stay details.</p>
            <form className="room-form" onSubmit={handleCreateBooking}>
              <label htmlFor="booking-room">Room</label>
              <select id="booking-room" value={bookingForm.roomId} onChange={(event) => {
                const nextRoom = rooms.find((room) => room.id === event.target.value)
                setBookingForm((current) => ({
                  ...current,
                  roomId: event.target.value,
                  guestCount: String(Math.min(Number(current.guestCount), nextRoom?.capacity || 1)),
                }))
                setFormError('')
              }} required>
                <option value="" disabled>Select a room</option>
                {rooms.map((room) => (
                  <option key={room.id} value={room.id} disabled={['Cleaning', 'Maintenance'].includes(room.status)}>
                    Room {room.roomNumber} · {room.roomType} · up to {room.capacity} guests
                  </option>
                ))}
              </select>

              <label htmlFor="booking-guest-name">Guest name</label>
              <input autoFocus id="booking-guest-name" maxLength="120" value={bookingForm.guestName} onChange={updateBookingForm('guestName')} required />
              <div className="room-form-row">
                <div>
                  <label htmlFor="booking-email">Email <span>(optional)</span></label>
                  <input id="booking-email" type="email" maxLength="254" value={bookingForm.guestEmail} onChange={updateBookingForm('guestEmail')} />
                </div>
                <div>
                  <label htmlFor="booking-phone">Phone <span>(optional)</span></label>
                  <input id="booking-phone" type="tel" maxLength="32" value={bookingForm.guestPhone} onChange={updateBookingForm('guestPhone')} />
                </div>
              </div>
              <div className="room-form-row">
                <div>
                  <label htmlFor="booking-check-in">Arrival</label>
                  <input id="booking-check-in" type="date" value={bookingForm.checkInDate} onChange={updateBookingForm('checkInDate')} required />
                </div>
                <div>
                  <label htmlFor="booking-check-out">Departure</label>
                  <input id="booking-check-out" type="date" min={addOneDay(bookingForm.checkInDate)} value={bookingForm.checkOutDate} onChange={updateBookingForm('checkOutDate')} required />
                </div>
              </div>
              <div className="room-form-row booking-form-bottom">
                <div>
                  <label htmlFor="booking-guests">Guests</label>
                  <input
                    id="booking-guests"
                    type="number"
                    min="1"
                    max={selectedRoom?.capacity || 12}
                    step="1"
                    value={bookingForm.guestCount}
                    onChange={updateBookingForm('guestCount')}
                    required
                  />
                </div>
                <p className="booking-total">{formatRate(bookingTotal)}<small> estimated total</small></p>
              </div>
              {formError && <p className="form-error" role="alert">{formError}</p>}
              <div className="room-form-actions">
                <button className="cancel-room-button" type="button" onClick={() => setIsBookingOpen(false)} disabled={isSavingBooking}>Cancel</button>
                <button className="add-room-button" type="submit" disabled={isSavingBooking || rooms.length === 0}>
                  {isSavingBooking ? 'Saving…' : 'Create booking'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  )
}

export default ReservationManager
