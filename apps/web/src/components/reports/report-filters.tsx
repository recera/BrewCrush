'use client'

import { useState } from 'react'
import { Filter, X, ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Badge } from '@/components/ui/badge'

interface FilterOption {
  key: string
  label: string
  type: 'text' | 'select' | 'date' | 'number'
  placeholder?: string
  options?: Array<{ value: string; label: string }>
}

interface ReportFiltersProps {
  filters: Record<string, any>
  onFiltersChange: (filters: Record<string, any>) => void
  filterOptions: FilterOption[]
}

export function ReportFilters({
  filters,
  onFiltersChange,
  filterOptions
}: ReportFiltersProps) {
  const [isOpen, setIsOpen] = useState(false)
  
  const activeFilterCount = Object.keys(filters).filter(
    key => filters[key] !== undefined && filters[key] !== '' && filters[key] !== null
  ).length

  const handleFilterChange = (key: string, value: any) => {
    const newFilters = { ...filters }
    
    if (value === '' || value === undefined || value === null) {
      delete newFilters[key]
    } else {
      newFilters[key] = value
    }
    
    onFiltersChange(newFilters)
  }

  const clearAllFilters = () => {
    onFiltersChange({})
  }

  const clearFilter = (key: string) => {
    const newFilters = { ...filters }
    delete newFilters[key]
    onFiltersChange(newFilters)
  }

  const renderFilterInput = (option: FilterOption) => {
    const currentValue = filters[option.key] || ''

    switch (option.type) {
      case 'text':
        return (
          <Input
            placeholder={option.placeholder}
            value={currentValue}
            onChange={(e) => handleFilterChange(option.key, e.target.value)}
            className="w-full"
          />
        )

      case 'select':
        return (
          <Select
            value={currentValue}
            onValueChange={(value) => handleFilterChange(option.key, value)}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder={`Select ${option.label.toLowerCase()}`} />
            </SelectTrigger>
            <SelectContent>
              {option.options?.map((optionItem) => (
                <SelectItem key={optionItem.value} value={optionItem.value}>
                  {optionItem.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )

      case 'date':
        return (
          <Input
            type="date"
            value={currentValue}
            onChange={(e) => handleFilterChange(option.key, e.target.value)}
            className="w-full"
          />
        )

      case 'number':
        return (
          <Input
            type="number"
            placeholder={option.placeholder}
            value={currentValue}
            onChange={(e) => handleFilterChange(option.key, e.target.value)}
            className="w-full"
          />
        )

      default:
        return null
    }
  }

  return (
    <Card>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-muted/30 transition-colors">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Filter className="h-4 w-4" />
                <CardTitle className="text-lg">Filters</CardTitle>
                {activeFilterCount > 0 && (
                  <Badge variant="secondary" className="ml-2">
                    {activeFilterCount} active
                  </Badge>
                )}
              </div>
              <div className="flex items-center space-x-2">
                {activeFilterCount > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation()
                      clearAllFilters()
                    }}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    Clear all
                  </Button>
                )}
                {isOpen ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </div>
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        
        <CollapsibleContent>
          <CardContent className="pt-0">
            {/* Active filters */}
            {activeFilterCount > 0 && (
              <div className="mb-4">
                <div className="flex flex-wrap gap-2">
                  {Object.entries(filters)
                    .filter(([_, value]) => value !== undefined && value !== '' && value !== null)
                    .map(([key, value]) => {
                      const option = filterOptions.find(opt => opt.key === key)
                      const displayValue = option?.type === 'select' 
                        ? option.options?.find(opt => opt.value === value)?.label || value
                        : value

                      return (
                        <Badge key={key} variant="outline" className="flex items-center space-x-1">
                          <span className="text-xs font-medium">
                            {option?.label}: {displayValue}
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-auto p-0 hover:bg-transparent"
                            onClick={() => clearFilter(key)}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </Badge>
                      )
                    })}
                </div>
              </div>
            )}

            {/* Filter inputs */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {filterOptions.map((option) => (
                <div key={option.key} className="space-y-2">
                  <label className="text-sm font-medium text-muted-foreground">
                    {option.label}
                  </label>
                  {renderFilterInput(option)}
                </div>
              ))}
            </div>

            {/* Quick filter shortcuts */}
            <div className="mt-4 pt-4 border-t">
              <div className="text-sm font-medium text-muted-foreground mb-2">
                Quick Filters
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleFilterChange('below_reorder', 'true')}
                  className={filters.below_reorder === 'true' ? 'bg-orange-50 border-orange-200' : ''}
                >
                  Low Stock Only
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleFilterChange('expiring_soon', 'true')}
                  className={filters.expiring_soon === 'true' ? 'bg-red-50 border-red-200' : ''}
                >
                  Expiring Soon
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleFilterChange('item_type', 'raw')}
                  className={filters.item_type === 'raw' ? 'bg-blue-50 border-blue-200' : ''}
                >
                  Raw Materials Only
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleFilterChange('item_type', 'finished')}
                  className={filters.item_type === 'finished' ? 'bg-green-50 border-green-200' : ''}
                >
                  Finished Goods Only
                </Button>
              </div>
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  )
}