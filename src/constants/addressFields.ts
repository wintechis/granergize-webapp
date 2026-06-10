/** The fields every building must state: address + coordinates (the map needs a
 * position; everything else is optional master data). Shared by the Add dialog's
 * per-building validity check and the Edit dialog's save guard, so a building
 * can't be created OR edited into an unmappable state. (A constants module, not
 * an export of the field components — react-refresh wants component files pure.) */
export const ADDRESS_FIELDS = [
  "streetAddress",
  "locality",
  "postalCode",
  "region",
  "lat",
  "long",
];
