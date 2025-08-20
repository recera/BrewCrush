-- This migration creates the PO summary materialized view
-- It's in a separate file because it uses the 'cancelled' enum value
-- which was added in a previous migration and cannot be used in the same transaction

-- Create materialized view for PO summary by vendor
CREATE MATERIALIZED VIEW IF NOT EXISTS po_summary_by_vendor AS
SELECT 
  po.vendor_id,
  v.name as vendor_name,
  COUNT(DISTINCT po.id) as total_pos,
  COUNT(DISTINCT CASE WHEN po.status = 'draft' THEN po.id END) as draft_count,
  COUNT(DISTINCT CASE WHEN po.status = 'approved' THEN po.id END) as approved_count,
  COUNT(DISTINCT CASE WHEN po.status IN ('partial', 'received') THEN po.id END) as in_progress_count,
  COUNT(DISTINCT CASE WHEN po.status = 'closed' THEN po.id END) as closed_count,
  COUNT(DISTINCT CASE WHEN po.status = 'cancelled' THEN po.id END) as cancelled_count,
  SUM(
    CASE 
      WHEN po.status NOT IN ('cancelled', 'draft') 
      THEN COALESCE(
        (SELECT SUM(pl.qty * pl.expected_unit_cost) 
         FROM po_lines pl 
         WHERE pl.po_id = po.id), 0)
      ELSE 0 
    END
  ) as total_value,
  AVG(
    CASE 
      WHEN po.status = 'closed' 
      THEN DATE_PART('day', po.updated_at - po.created_at)
      ELSE NULL 
    END
  ) as avg_days_to_close,
  MAX(po.created_at) as last_po_date
FROM purchase_orders po
JOIN vendors v ON v.id = po.vendor_id
GROUP BY po.vendor_id, v.name;

-- Create index on the materialized view
CREATE INDEX idx_po_summary_vendor ON po_summary_by_vendor(vendor_id);

-- Grant permissions
GRANT SELECT ON po_summary_by_vendor TO authenticated;

-- Update the refresh function to actually refresh the view
CREATE OR REPLACE FUNCTION refresh_po_summary()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY po_summary_by_vendor;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;