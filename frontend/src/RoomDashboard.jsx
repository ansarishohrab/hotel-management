import { useEffect, useMemo, useState } from 'react'
import { createRoom, getRooms } from './api'
import ReservationManager from './ReservationManager'
import './RoomDashboard.css'

const initialRoomForm = {
  roomNumber: '',
  roomType: 'Standard',
  capacity: '2',
  nightlyRate: '',
}

const roomFilters = ['All rooms', 'Available', 'Occupied', 'Cleaning', 'Maintenance']

function getErrorMessage(error, fallback) {
  return error instanceof Error ? error.message : fallback
}

function sortRooms(rooms) {
  return [...rooms].sort((a, b) => a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true }))
}

function RoomIcon({ name }) {
  if (name === 'bed') {
    return (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M3 19V8m0 7h18v4M3 12h18v3M7 12V9.5A2.5 2.5 0 0 1 9.5 7h2A2.5 2.5 0 0 1 14 9.5V12" />
      </svg>
    )
  }

  if (name === 'person') {
    return (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="8" r="3" />
        <path d="M5.5 20a6.5 6.5 0 0 1 13 0" />
      </svg>
    )
  }

  if (name === 'search') {
    return (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="10.8" cy="10.8" r="6.3" />
        <path d="m16 16 4.2 4.2" />
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

function RoomDashboard({ user, hotel, onSignOut, onEditHotel }) {
  const [rooms, setRooms] = useState([])
  const [activeView, setActiveView] = useState('rooms')
  const [bookingRoomId, setBookingRoomId] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [search, setSearch] = useState('')
  const [activeFilter, setActiveFilter] = useState('All rooms')
  const [isAddRoomOpen, setIsAddRoomOpen] = useState(false)
  const [roomForm, setRoomForm] = useState(initialRoomForm)
  const [formError, setFormError] = useState('')
  const [isSavingRoom, setIsSavingRoom] = useState(false)

  const currency = hotel.country === 'United States' ? 'USD' : 'INR'
  const locale = currency === 'USD' ? 'en-US' : 'en-IN'
  const formatRate = (rate) => new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(rate)

  const refreshRooms = async () => {
    setIsLoading(true)

    try {
      const data = await getRooms(user)
      setRooms(sortRooms(data.rooms))
      setLoadError('')
    } catch (error) {
      setLoadError(getErrorMessage(error, 'Could not load rooms. Please try again.'))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    let active = true
    getRooms(user)
      .then((data) => {
        if (!active) return
        setRooms(sortRooms(data.rooms))
        setLoadError('')
      })
      .catch((error) => {
        if (active) setLoadError(getErrorMessage(error, 'Could not load rooms. Please try again.'))
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })

    return () => {
      active = false
    }
  }, [user])

  const [todayLabel] = useState(() => new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date()))

  useEffect(() => {
    if (!isAddRoomOpen) return undefined

    const closeOnEscape = (event) => {
      if (event.key === 'Escape' && !isSavingRoom) setIsAddRoomOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [isAddRoomOpen, isSavingRoom])

  const filteredRooms = useMemo(() => {
    const query = search.trim().toLowerCase()

    return rooms.filter((room) => {
      const matchesStatus = activeFilter === 'All rooms' || room.status === activeFilter
      const matchesSearch = !query
        || room.roomNumber.toLowerCase().includes(query)
        || room.roomType.toLowerCase().includes(query)
      return matchesStatus && matchesSearch
    })
  }, [activeFilter, rooms, search])

  const roomCounts = useMemo(() => ({
    total: rooms.length,
    available: rooms.filter((room) => room.status === 'Available').length,
    occupied: rooms.filter((room) => room.status === 'Occupied').length,
    attention: rooms.filter((room) => ['Cleaning', 'Maintenance'].includes(room.status)).length,
  }), [rooms])

  const updateRoomForm = (field) => (event) => {
    setRoomForm((current) => ({ ...current, [field]: event.target.value }))
    setFormError('')
  }

  const handleAddRoom = async (event) => {
    event.preventDefault()
    setFormError('')
    setIsSavingRoom(true)

    try {
      const room = await createRoom(user, {
        ...roomForm,
        roomNumber: roomForm.roomNumber.trim(),
        capacity: Number(roomForm.capacity),
        nightlyRate: Number(roomForm.nightlyRate),
      })
      setRooms((current) => sortRooms([...current, room]))
      setRoomForm(initialRoomForm)
      setIsAddRoomOpen(false)
    } catch (error) {
      setFormError(getErrorMessage(error, 'Could not save this room. Please try again.'))
    } finally {
      setIsSavingRoom(false)
    }
  }

  return (
    <main className="room-dashboard">
      <aside className="dashboard-sidebar">
        <a className="dashboard-brand" href="#rooms" aria-label="Haven rooms">
          <span className="dashboard-brand-icon" aria-hidden="true">
            <svg viewBox="0 0 32 32" fill="none">
              <path d="M5 26V12.5L16 5l11 7.5V26H5Z" />
              <path d="M12 26v-8h8v8M10 13h.01M16 13h.01M22 13h.01" />
            </svg>
          </span>
          <span>haven<span>.</span></span>
        </a>

        <p className="sidebar-label">PROPERTY</p>
        <div className="property-switcher">
          <span className="property-avatar">{hotel.name.charAt(0).toUpperCase()}</span>
          <span className="property-name">
            <strong>{hotel.name}</strong>
            <small>{hotel.city}</small>
          </span>
        </div>

        <nav className="dashboard-nav" aria-label="Main navigation">
          <button
            className={activeView === 'rooms' ? 'dashboard-nav-link active' : 'dashboard-nav-link'}
            type="button"
            onClick={() => setActiveView('rooms')}
            aria-current={activeView === 'rooms' ? 'page' : undefined}
          >
            <RoomIcon name="bed" />
            Rooms
            <span className="nav-count">{roomCounts.total}</span>
          </button>
          <button
            className={activeView === 'reservations' ? 'dashboard-nav-link active' : 'dashboard-nav-link'}
            type="button"
            onClick={() => setActiveView('reservations')}
            aria-current={activeView === 'reservations' ? 'page' : undefined}
          >
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect x="4" y="5" width="16" height="16" rx="2" />
              <path d="M8 3v4m8-4v4M4 10h16" />
            </svg>
            Reservations
          </button>
        </nav>

        <div className="sidebar-bottom">
          <button className="sidebar-user" type="button" onClick={onSignOut}>
            <span className="user-avatar">{(user.email || 'H').charAt(0).toUpperCase()}</span>
            <span><strong>{user.email}</strong><small>Sign out</small></span>
            <span className="user-menu" aria-hidden="true">···</span>
          </button>
        </div>
      </aside>

      <section className="dashboard-main" id="rooms">
        <header className="dashboard-topbar">
          <div className="breadcrumbs"><span>Property</span><span>/</span><strong>{activeView === 'rooms' ? 'Rooms' : 'Reservations'}</strong></div>
          <div className="topbar-actions">
            <button className="topbar-link" type="button" onClick={onEditHotel}>Hotel settings</button>
            <span className="topbar-divider" />
            <span className="topbar-date">{todayLabel}</span>
            <span className="topbar-avatar">{(user.email || 'H').charAt(0).toUpperCase()}</span>
          </div>
        </header>

        {activeView === 'rooms' ? (
        <div className="dashboard-content">
          <div className="dashboard-heading">
            <div>
              <p className="dashboard-eyebrow">YOUR PROPERTY</p>
              <h1>Rooms <span>{roomCounts.total}</span></h1>
              <p className="dashboard-subtitle">A clear view of every room at {hotel.name}.</p>
            </div>
            <button className="add-room-button" type="button" onClick={() => {
              setFormError('')
              setIsAddRoomOpen(true)
            }}>
              <RoomIcon name="plus" />
              Add a room
            </button>
          </div>

          <div className="room-stat-grid" aria-label="Room summary">
            <article className="room-stat-card">
              <span className="stat-icon stat-icon-green"><RoomIcon name="bed" /></span>
              <div><span className="stat-label">Total rooms</span><strong>{roomCounts.total}</strong><small>In your property</small></div>
            </article>
            <article className="room-stat-card">
              <span className="stat-icon stat-icon-sage"><span className="stat-dot" /></span>
              <div><span className="stat-label">Available</span><strong>{roomCounts.available}</strong><small>Ready for guests</small></div>
            </article>
            <article className="room-stat-card">
              <span className="stat-icon stat-icon-amber"><RoomIcon name="person" /></span>
              <div><span className="stat-label">Occupied</span><strong>{roomCounts.occupied}</strong><small>{roomCounts.total ? Math.round((roomCounts.occupied / roomCounts.total) * 100) : 0}% occupancy</small></div>
            </article>
            <article className="room-stat-card">
              <span className="stat-icon stat-icon-rose"><span className="attention-dot" /></span>
              <div><span className="stat-label">Needs attention</span><strong>{roomCounts.attention}</strong><small>Cleaning or maintenance</small></div>
            </article>
          </div>

          <section className="rooms-panel" aria-labelledby="room-list-title">
            <div className="rooms-panel-heading">
              <div>
                <h2 id="room-list-title">All rooms</h2>
                <p>Manage your room inventory and availability.</p>
              </div>
              <button className="refresh-button" type="button" onClick={refreshRooms} disabled={isLoading} aria-label="Refresh rooms">
                <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path d="M16.4 8A6.5 6.5 0 0 0 5 5.2L3.5 7M3.5 7V3.7M3.5 7h3.3M3.6 12a6.5 6.5 0 0 0 11.4 2.8l1.5-1.8m0 0v3.3m0-3.3h-3.3" />
                </svg>
              </button>
            </div>

            <div className="room-toolbar">
              <div className="room-filters" role="group" aria-label="Filter rooms by status">
                {roomFilters.map((filter) => (
                  <button
                    className={activeFilter === filter ? 'room-filter active' : 'room-filter'}
                    key={filter}
                    type="button"
                    onClick={() => setActiveFilter(filter)}
                    aria-pressed={activeFilter === filter}
                  >
                    {filter}
                    {filter === 'All rooms' && <span>{roomCounts.total}</span>}
                  </button>
                ))}
              </div>
              <label className="room-search">
                <RoomIcon name="search" />
                <span className="sr-only">Search rooms</span>
                <input
                  type="search"
                  placeholder="Search rooms"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
                <kbd>/</kbd>
              </label>
            </div>

            {loadError ? (
              <div className="room-message room-error" role="alert">
                <span>{loadError}</span>
                <button type="button" onClick={refreshRooms}>Try again</button>
              </div>
            ) : isLoading ? (
              <div className="room-message" role="status">
                <span className="dashboard-spinner" aria-hidden="true" />
                Loading rooms…
              </div>
            ) : filteredRooms.length === 0 ? (
              <div className="room-empty-state">
                <span className="empty-bed-icon"><RoomIcon name="bed" /></span>
                <h3>{rooms.length === 0 ? 'Your room list starts here' : 'No rooms match your search'}</h3>
                <p>{rooms.length === 0
                  ? 'Add your first room to start building your property inventory.'
                  : 'Try a different search or status filter.'}</p>
                {rooms.length === 0 && (
                  <button className="add-room-button empty-add-button" type="button" onClick={() => setIsAddRoomOpen(true)}>
                    <RoomIcon name="plus" />
                    Add your first room
                  </button>
                )}
              </div>
            ) : (
              <div className="room-table-wrap">
                <table className="room-table">
                  <thead>
                    <tr>
                      <th scope="col">ROOM</th>
                      <th scope="col">ROOM TYPE</th>
                      <th scope="col">GUESTS</th>
                      <th scope="col">NIGHTLY RATE</th>
                      <th scope="col">STATUS</th>
                      <th scope="col"><span className="sr-only">Booking action</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRooms.map((room) => (
                      <tr key={room.id}>
                        <td><span className="room-number">{room.roomNumber}</span></td>
                        <td><span className="room-type">{room.roomType}</span></td>
                        <td><span className="guest-count"><RoomIcon name="person" />{room.capacity}</span></td>
                        <td><span className="room-rate">{formatRate(room.nightlyRate)}<small> / night</small></span></td>
                        <td><span className={`room-status status-${room.status.toLowerCase()}`}><i />{room.status}</span></td>
                        <td>
                          <button
                            className="room-book-action"
                            type="button"
                            onClick={() => {
                              setBookingRoomId(room.id)
                              setActiveView('reservations')
                            }}
                            disabled={['Cleaning', 'Maintenance'].includes(room.status)}
                          >
                            Book
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="room-table-footer">Showing <strong>{filteredRooms.length}</strong> of <strong>{rooms.length}</strong> rooms</div>
              </div>
            )}
          </section>

          <p className="dashboard-footnote">Room inventory is securely saved to your hotel account.</p>
        </div>
        ) : (
          <ReservationManager
            user={user}
            rooms={rooms}
            locale={locale}
            formatRate={formatRate}
            initialRoomId={bookingRoomId}
            onRoomStatusChanged={refreshRooms}
          />
        )}
      </section>

      {isAddRoomOpen && (
        <div className="room-modal-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !isSavingRoom) setIsAddRoomOpen(false)
        }}>
          <section className="room-modal" role="dialog" aria-modal="true" aria-labelledby="add-room-title">
            <button className="modal-close" type="button" onClick={() => setIsAddRoomOpen(false)} disabled={isSavingRoom} aria-label="Close dialog">×</button>
            <p className="dashboard-eyebrow">ROOM INVENTORY</p>
            <h2 id="add-room-title">Add a room</h2>
            <p className="modal-description">Add the basics now. You can update room status as your team works.</p>
            <form className="room-form" onSubmit={handleAddRoom}>
              <label htmlFor="room-number">Room number</label>
              <input
                autoFocus
                id="room-number"
                maxLength="20"
                placeholder="e.g. 204"
                value={roomForm.roomNumber}
                onChange={updateRoomForm('roomNumber')}
                required
              />
              <label htmlFor="room-type">Room type</label>
              <select id="room-type" value={roomForm.roomType} onChange={updateRoomForm('roomType')}>
                <option>Standard</option>
                <option>Deluxe</option>
                <option>Suite</option>
                <option>Family</option>
              </select>
              <div className="room-form-row">
                <div>
                  <label htmlFor="room-capacity">Guest capacity</label>
                  <input
                    id="room-capacity"
                    type="number"
                    min="1"
                    max="12"
                    step="1"
                    value={roomForm.capacity}
                    onChange={updateRoomForm('capacity')}
                    required
                  />
                </div>
                <div>
                  <label htmlFor="room-rate">Rate per night ({currency})</label>
                  <input
                    id="room-rate"
                    type="number"
                    min="0.01"
                    max="99999999"
                    step="0.01"
                    placeholder="0.00"
                    value={roomForm.nightlyRate}
                    onChange={updateRoomForm('nightlyRate')}
                    required
                  />
                </div>
              </div>
              {formError && <p className="form-error" role="alert">{formError}</p>}
              <div className="room-form-actions">
                <button className="cancel-room-button" type="button" onClick={() => setIsAddRoomOpen(false)} disabled={isSavingRoom}>Cancel</button>
                <button className="add-room-button" type="submit" disabled={isSavingRoom}>
                  {isSavingRoom ? 'Saving…' : 'Save room'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </main>
  )
}

export default RoomDashboard
