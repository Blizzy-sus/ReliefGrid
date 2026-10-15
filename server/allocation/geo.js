const R_KM = 6371.0088;
const rad = (d) => (d * Math.PI) / 180;

/** Great-circle distance in km. */
export function haversineKm(lat1, lon1, lat2, lon2) {
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Estimated road distance: straight line times a detour factor, one decimal. */
export function roadDistanceKm(a, b, detour = 1.35) {
  return Math.round(haversineKm(a.latitude, a.longitude, b.latitude, b.longitude) * detour * 10) / 10;
}
