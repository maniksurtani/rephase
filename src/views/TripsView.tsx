import { ArrowRight, Check, Info, Pencil, Plane, Plus, Trash2 } from 'lucide-react';
import type { Trip } from '../lib/types';
import { airportCity, dateLabel } from '../lib/display';
import { aircraftLabel } from '../lib/aircraft';

interface TripsViewProps {
  trips: Trip[];
  selectedTripId?: string;
  onCreateTrip: () => void;
  onViewPlan: (id: string) => void;
  onEditTrip: (trip: Trip) => void;
  onDeleteTrip: (id: string) => void;
}
export function TripsView({
  trips,
  selectedTripId,
  onCreateTrip,
  onViewPlan,
  onEditTrip,
  onDeleteTrip,
}: TripsViewProps) {
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow muted">Every stop belongs in the story</span>
          <h1>Your trips</h1>
          <p>Connections, longer stays, and the journey home.</p>
        </div>
        <button type="button" className="button primary" onClick={onCreateTrip}>
          <Plus size={17} />
          New trip
        </button>
      </div>
      <div className="trips-grid">
        {trips.map((value) => (
          <section
            className={`saved-trip-card ${selectedTripId === value.id ? 'selected-trip' : ''}`}
            key={value.id}
          >
            <div className="saved-trip-top">
              <span className="small-icon">
                <Plane size={20} />
              </span>
              <div className="saved-trip-badges">
                {value.id.startsWith('demo-') && <span className="pill demo-pill">Example</span>}
                {selectedTripId === value.id && (
                  <span className="pill selected-pill">
                    <Check size={12} />
                    Selected
                  </span>
                )}
              </div>
            </div>
            <h2>{value.name}</h2>
            <p className="trip-dates">
              {dateLabel(value.legs[0]?.departureDateTime ?? '')}
              {value.legs.length > 1 && ` – ${dateLabel(value.legs.at(-1)?.arrivalDateTime ?? '')}`}
            </p>
            <div className="mini-itinerary">
              {value.legs.map((leg, index) => (
                <div className="mini-leg" key={leg.id}>
                  <div className="mini-leg-track">
                    <span
                      className={`itinerary-dot ${leg.stayAfter === 'connection' ? 'hollow' : ''}`}
                    />
                    {index < value.legs.length - 1 && <span className="itinerary-line" />}
                  </div>
                  <div>
                    <strong>
                      {index === 0 ? `${airportCity(leg.departureAirport)} → ` : ''}
                      {airportCity(leg.arrivalAirport)}
                    </strong>
                    <span>
                      {leg.stayAfter === 'connection'
                        ? 'Connection'
                        : leg.strategy === 'home'
                          ? 'Keep home rhythm'
                          : leg.strategy === 'partial'
                            ? 'Partial adjustment'
                            : 'Adjust to destination'}
                      {leg.flightNumber && ` · ${leg.flightNumber}`}
                    </span>
                    {aircraftLabel(leg.aircraft) && (
                      <small className="mini-aircraft">
                        Aircraft · {aircraftLabel(leg.aircraft)}
                      </small>
                    )}
                  </div>
                  <span className="mini-airport">{leg.arrivalAirport}</span>
                </div>
              ))}
            </div>
            <div className="saved-trip-actions">
              <button
                type="button"
                className="button secondary"
                onClick={() => onViewPlan(value.id)}
              >
                View plan <ArrowRight size={15} />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label={`Edit ${value.name}`}
                onClick={() => onEditTrip(value)}
              >
                <Pencil size={16} />
              </button>
              <button
                type="button"
                className="icon-button danger-icon"
                aria-label={`Delete ${value.name}`}
                onClick={() => onDeleteTrip(value.id)}
              >
                <Trash2 size={16} />
              </button>
            </div>
          </section>
        ))}
        <button type="button" className="add-trip-card" onClick={onCreateTrip}>
          <span>
            <Plus size={24} />
          </span>
          <strong>Where to next?</strong>
          <p>Build a plan around your next adventure.</p>
        </button>
      </div>
      <div className="manual-entry-note">
        <Info size={16} />
        <p>Look up a flight by number and departure date, or enter it manually.</p>
      </div>
    </>
  );
}
