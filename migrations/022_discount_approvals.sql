-- 022_discount_approvals.sql
--
-- Manager approval for large discounts + automatic promotions
-- (2026-10-05). Markdowns over 20% of a line's catalog value now need a
-- manager PIN, enforced by the capture route; the approving manager is
-- recorded on the line. Lines discounted by an automatic promotion
-- (pos_discount_rules) record which rule.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS.

BEGIN;

ALTER TABLE pos_sale_lines
  ADD COLUMN IF NOT EXISTS discount_approved_by INT REFERENCES pos_employees(id),
  ADD COLUMN IF NOT EXISTS promo_rule_id INT REFERENCES pos_discount_rules(id);

COMMIT;
