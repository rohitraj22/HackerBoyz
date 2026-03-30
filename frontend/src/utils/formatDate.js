const IST_TIME_ZONE = 'Asia/Kolkata';
const IST_LOCALE = 'en-IN';

const istDateTimeFormatter = new Intl.DateTimeFormat(IST_LOCALE, {
  timeZone: IST_TIME_ZONE,
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: true,
  timeZoneName: 'short',
});

export function formatDate(value) {
  if (!value) return '-';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';

  return istDateTimeFormatter.format(date);
}
