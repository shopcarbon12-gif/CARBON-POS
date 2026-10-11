/**
 * "The register this employee is working on": their own open register
 * session at the store they're signed in to, otherwise the store's open
 * session. A register belongs to the store, not to whoever opened it —
 * anyone signed in at the store can ring sales on it and close it (each
 * sale still records who rang it up).
 *
 * Returns a SQL predicate on alias `s` (pos_register_sessions) given the
 * placeholders holding the user's id and the store's wms_location_id.
 */
export function currentSessionWhere(userParam: string, lidParam: string): string {
  return `s.id = (
    SELECT cs.id
      FROM pos_register_sessions cs
      JOIN pos_registers cr  ON cr.id = cs.register_id
      JOIN pos_locations cpl ON cpl.id = cr.pos_location_id
     WHERE cs.status = 'open' AND cpl.wms_location_id = ${lidParam}::uuid
     ORDER BY (cs.opened_by = ${userParam}::uuid) DESC, cs.opened_at DESC
     LIMIT 1)`;
}
