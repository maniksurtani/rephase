/** Only itinerary locations cross the planner boundary, never the searchable airport catalog. */
export interface PlanningAirport {
  city: string;
  latitude?: number;
  longitude?: number;
}

export interface PlanningContext {
  airports: Record<string, PlanningAirport>;
}

export function planningStayLabel(
  context: PlanningContext,
  code: string,
  destination: boolean,
): string {
  const city = context.airports[code.trim().toUpperCase()]?.city.trim();
  return city
    ? `${destination ? 'Stay' : 'Connection'} in ${city}`
    : destination
      ? 'Stay at destination'
      : 'Connection';
}
