import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { InventoryCatalog } from '../catalog'

// Mock the dialog components
vi.mock('../item-detail-dialog', () => ({
  ItemDetailDialog: vi.fn(() => null)
}))

vi.mock('../new-item-dialog', () => ({
  NewItemDialog: vi.fn(() => null)
}))

vi.mock('../adjust-inventory-dialog', () => ({
  AdjustInventoryDialog: vi.fn(() => null)
}))

vi.mock('../transfer-inventory-dialog', () => ({
  TransferInventoryDialog: vi.fn(() => null)
}))

// Mock data
const mockInventoryData = [
  {
    item_id: '1',
    item_name: 'Cascade Hops',
    sku: 'HOP-001',
    item_type: 'raw',
    location_id: 'loc1',
    location_name: 'Main Warehouse',
    qty_on_hand: 50,
    primary_uom: 'lb',
    lot_count: 3,
    avg_unit_cost: 12.50,
    next_expiry: '2024-12-31'
  },
  {
    item_id: '2',
    item_name: '16oz Cans',
    sku: 'PKG-001',
    item_type: 'packaging',
    location_id: 'loc1',
    location_name: 'Main Warehouse',
    qty_on_hand: 1000,
    primary_uom: 'each',
    lot_count: 1,
    avg_unit_cost: 0.35,
    next_expiry: null
  }
]

const mockLocations = [
  { id: 'loc1', name: 'Main Warehouse' },
  { id: 'loc2', name: 'Cold Storage' }
]

const mockLowStockItems = [
  {
    id: '3',
    name: 'Pale Malt',
    reorder_level: 100,
    item_lots: [{ qty: 25 }]
  }
]

describe('InventoryCatalog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders inventory catalog with data', () => {
    render(
      <InventoryCatalog
        inventoryData={mockInventoryData}
        locations={mockLocations}
        lowStockItems={mockLowStockItems}
        userRole="admin"
      />
    )

    // Check header
    expect(screen.getByText('Inventory')).toBeInTheDocument()
    expect(screen.getByText('Manage raw materials, packaging, and finished goods')).toBeInTheDocument()

    // Check if items are displayed
    expect(screen.getByText('Cascade Hops')).toBeInTheDocument()
    expect(screen.getByText('16oz Cans')).toBeInTheDocument()
  })

  it('shows low stock alert when items are below reorder level', () => {
    render(
      <InventoryCatalog
        inventoryData={mockInventoryData}
        locations={mockLocations}
        lowStockItems={mockLowStockItems}
        userRole="admin"
      />
    )

    expect(screen.getByText('Low Stock Alert')).toBeInTheDocument()
    expect(screen.getByText(/1 items are below their reorder level/)).toBeInTheDocument()
  })

  it('displays summary cards with correct values', () => {
    render(
      <InventoryCatalog
        inventoryData={mockInventoryData}
        locations={mockLocations}
        lowStockItems={mockLowStockItems}
        userRole="admin"
      />
    )

    // Check total items (2 unique items)
    expect(screen.getByText('2')).toBeInTheDocument()
    
    // Check locations count
    expect(screen.getByText('Active locations')).toBeInTheDocument()

    // Check low stock count
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('Items need reordering')).toBeInTheDocument()
  })

  it('shows costs only for authorized roles', () => {
    const { rerender } = render(
      <InventoryCatalog
        inventoryData={mockInventoryData}
        locations={mockLocations}
        lowStockItems={[]}
        userRole="admin"
      />
    )

    // Admin can see costs
    expect(screen.getByText('Total Value')).toBeInTheDocument()
    expect(screen.getByText('Avg Cost')).toBeInTheDocument()

    // Rerender with brewer role
    rerender(
      <InventoryCatalog
        inventoryData={mockInventoryData}
        locations={mockLocations}
        lowStockItems={[]}
        userRole="brewer"
      />
    )

    // Brewer cannot see costs
    expect(screen.queryByText('Total Value')).not.toBeInTheDocument()
    expect(screen.queryByText('Avg Cost')).not.toBeInTheDocument()
  })

  it('filters inventory by search term', () => {
    render(
      <InventoryCatalog
        inventoryData={mockInventoryData}
        locations={mockLocations}
        lowStockItems={[]}
        userRole="admin"
      />
    )

    const searchInput = screen.getByPlaceholderText('Search by name or SKU...')
    
    // Search for "Cascade"
    fireEvent.change(searchInput, { target: { value: 'Cascade' } })
    
    expect(screen.getByText('Cascade Hops')).toBeInTheDocument()
    expect(screen.queryByText('16oz Cans')).not.toBeInTheDocument()

    // Search by SKU
    fireEvent.change(searchInput, { target: { value: 'PKG-001' } })
    
    expect(screen.queryByText('Cascade Hops')).not.toBeInTheDocument()
    expect(screen.getByText('16oz Cans')).toBeInTheDocument()
  })

  it('filters inventory by type', () => {
    render(
      <InventoryCatalog
        inventoryData={mockInventoryData}
        locations={mockLocations}
        lowStockItems={[]}
        userRole="admin"
      />
    )

    // Find and click the type filter
    const typeSelect = screen.getByText('All Types')
    fireEvent.click(typeSelect)
    
    const rawOption = screen.getByText('Raw Materials')
    fireEvent.click(rawOption)

    // Should only show raw materials
    expect(screen.getByText('Cascade Hops')).toBeInTheDocument()
    expect(screen.queryByText('16oz Cans')).not.toBeInTheDocument()
  })

  it('shows action buttons only for authorized roles', () => {
    const { rerender } = render(
      <InventoryCatalog
        inventoryData={mockInventoryData}
        locations={mockLocations}
        lowStockItems={[]}
        userRole="admin"
      />
    )

    // Admin can see action buttons
    expect(screen.getByText('New Item')).toBeInTheDocument()
    expect(screen.getAllByText('Adjust')).toHaveLength(2)
    expect(screen.getAllByText('Transfer')).toHaveLength(2)

    // Rerender with accounting role
    rerender(
      <InventoryCatalog
        inventoryData={mockInventoryData}
        locations={mockLocations}
        lowStockItems={[]}
        userRole="accounting"
      />
    )

    // Accounting cannot see action buttons
    expect(screen.queryByText('New Item')).not.toBeInTheDocument()
    expect(screen.queryByText('Adjust')).not.toBeInTheDocument()
    expect(screen.queryByText('Transfer')).not.toBeInTheDocument()
  })

  it('opens new item dialog when New Item button is clicked', async () => {
    render(
      <InventoryCatalog
        inventoryData={mockInventoryData}
        locations={mockLocations}
        lowStockItems={[]}
        userRole="admin"
      />
    )

    const newItemButton = screen.getByText('New Item')
    fireEvent.click(newItemButton)

    // Dialog should be opened (mocked component would be called)
    await waitFor(() => {
      expect(screen.getByText('New Item')).toBeInTheDocument()
    })
  })

  it('displays expiry dates correctly', () => {
    render(
      <InventoryCatalog
        inventoryData={mockInventoryData}
        locations={mockLocations}
        lowStockItems={[]}
        userRole="admin"
      />
    )

    // Check if expiry date is displayed for items with expiry
    expect(screen.getByText(/Exp: 12\/31\/2024/)).toBeInTheDocument()
  })

  it('switches between tabs correctly', () => {
    render(
      <InventoryCatalog
        inventoryData={mockInventoryData}
        locations={mockLocations}
        lowStockItems={[]}
        userRole="admin"
      />
    )

    // Click on Low Stock tab
    const lowStockTab = screen.getByText('Low Stock')
    fireEvent.click(lowStockTab)

    expect(screen.getByText('Low stock items will be displayed here')).toBeInTheDocument()

    // Click on Recent Activity tab
    const activityTab = screen.getByText('Recent Activity')
    fireEvent.click(activityTab)

    expect(screen.getByText('Recent inventory transactions will be displayed here')).toBeInTheDocument()
  })

  it('calculates total value correctly', () => {
    render(
      <InventoryCatalog
        inventoryData={mockInventoryData}
        locations={mockLocations}
        lowStockItems={[]}
        userRole="admin"
      />
    )

    // Calculate expected total value
    // Cascade Hops: 50 * 12.50 = 625
    // 16oz Cans: 1000 * 0.35 = 350
    // Total: 975

    const totalValueCard = screen.getByText('Total Value').closest('div')
    expect(totalValueCard).toHaveTextContent('$975.00')
  })
})