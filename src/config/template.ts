/**
 * Fills {name} placeholders of a text from the yaml config:
 *   fillTemplate('Found {count} doctors.', { count: 3 }) -> 'Found 3 doctors.'
 * Unknown placeholders are left as they are, so a typo is visible in the output.
 */
export function fillTemplate(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in values ? String(values[name]) : match,
  );
}
