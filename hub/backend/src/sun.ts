// Sunrise / sunset from the standard sunrise equation (accurate to ~1–2 min, enough for lights).
const rad = Math.PI / 180;
const J2000 = 2451545.0;
const toJulian = (ms: number) => ms / 86_400_000 + 2440587.5;
const fromJulian = (j: number) => new Date((j - 2440587.5) * 86_400_000);

/** `day` is any instant on the local calendar day; returns null during polar day/night. */
export function sunTimes(day: Date, lat: number, lng: number): { sunrise: Date; sunset: Date } | null {
  const n = Math.round(toJulian(day.getTime()) - J2000 + 0.0008);
  const jStar = n - lng / 360;
  const M = (357.5291 + 0.98560028 * jStar) % 360;
  const C = 1.9148 * Math.sin(M * rad) + 0.02 * Math.sin(2 * M * rad) + 0.0003 * Math.sin(3 * M * rad);
  const lambda = (M + C + 180 + 102.9372) % 360;
  const transit = J2000 + jStar + 0.0053 * Math.sin(M * rad) - 0.0069 * Math.sin(2 * lambda * rad);
  const sinDec = Math.sin(lambda * rad) * Math.sin(23.4397 * rad);
  const cosDec = Math.cos(Math.asin(sinDec));
  const cosW = (Math.sin(-0.833 * rad) - Math.sin(lat * rad) * sinDec) / (Math.cos(lat * rad) * cosDec);
  if (cosW < -1 || cosW > 1) return null;
  const w = Math.acos(cosW) / rad / 360;
  return { sunrise: fromJulian(transit - w), sunset: fromJulian(transit + w) };
}
