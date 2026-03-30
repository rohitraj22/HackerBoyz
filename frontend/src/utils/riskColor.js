export function riskColor(level = '') {
  switch (level) {
    case 'Critical':
      return 'var(--critical)';
    case 'High':
      return 'var(--high)';
    case 'Moderate':
      return 'var(--moderate)';
    default:
      return 'var(--low)';
  }
}
