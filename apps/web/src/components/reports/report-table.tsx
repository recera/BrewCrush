'use client'

import { useState } from 'react'
import { ChevronUp, ChevronDown, ChevronsUpDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

interface Column {
  key: string
  label: string
  sortable?: boolean
  numeric?: boolean
  currency?: boolean
  hiddenForRole?: string
  type?: 'text' | 'date' | 'badge' | 'custom'
}

interface ReportTableProps {
  data: any[]
  columns: Column[]
  loading: boolean
  error?: string | null
  sortField?: string
  sortDirection?: 'asc' | 'desc'
  onSort?: (field: string, direction: 'asc' | 'desc') => void
  renderCell?: (item: any, column: Column) => React.ReactNode
  page?: number
  pageSize?: number
  totalItems?: number
  onPageChange?: (page: number) => void
  onPageSizeChange?: (pageSize: number) => void
  userRole?: string
}

export function ReportTable({
  data,
  columns,
  loading,
  error,
  sortField,
  sortDirection,
  onSort,
  renderCell,
  page = 1,
  pageSize = 50,
  totalItems = 0,
  onPageChange,
  onPageSizeChange,
  userRole = 'admin'
}: ReportTableProps) {
  // Filter columns based on role
  const visibleColumns = columns.filter(column => 
    !column.hiddenForRole || column.hiddenForRole !== userRole
  )

  const handleSort = (column: Column) => {
    if (!column.sortable || !onSort) return

    const newDirection = 
      sortField === column.key && sortDirection === 'asc' ? 'desc' : 'asc'
    
    onSort(column.key, newDirection)
  }

  const getSortIcon = (column: Column) => {
    if (!column.sortable) return null
    
    if (sortField !== column.key) {
      return <ChevronsUpDown className="h-4 w-4 text-muted-foreground" />
    }
    
    return sortDirection === 'asc' 
      ? <ChevronUp className="h-4 w-4" />
      : <ChevronDown className="h-4 w-4" />
  }

  const formatCellValue = (value: any, column: Column) => {
    if (value === null || value === undefined) return '—'
    
    switch (column.type) {
      case 'date':
        return new Date(value).toLocaleDateString()
      case 'badge':
        return value
      default:
        if (column.currency) {
          return typeof value === 'number' ? `$${value.toFixed(2)}` : value
        }
        if (column.numeric && typeof value === 'number') {
          return value.toLocaleString()
        }
        return String(value)
    }
  }

  const totalPages = Math.ceil(totalItems / pageSize)
  const startItem = (page - 1) * pageSize + 1
  const endItem = Math.min(page * pageSize, totalItems)

  if (error) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="text-center text-red-600">
            <p className="font-medium">Error loading report</p>
            <p className="text-sm text-muted-foreground mt-1">{error}</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b bg-muted/30">
                <tr>
                  {visibleColumns.map((column) => (
                    <th
                      key={column.key}
                      className={`px-4 py-3 text-left text-sm font-medium ${
                        column.sortable ? 'cursor-pointer hover:bg-muted/50' : ''
                      } ${column.numeric ? 'text-right' : 'text-left'}`}
                      onClick={() => handleSort(column)}
                    >
                      <div className={`flex items-center space-x-2 ${
                        column.numeric ? 'justify-end' : 'justify-start'
                      }`}>
                        <span>{column.label}</span>
                        {getSortIcon(column)}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  // Loading skeletons
                  Array.from({ length: Math.min(pageSize, 10) }).map((_, index) => (
                    <tr key={index} className="border-b">
                      {visibleColumns.map((column) => (
                        <td key={column.key} className="px-4 py-3">
                          <Skeleton className="h-4 w-full" />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : data.length === 0 ? (
                  <tr>
                    <td 
                      colSpan={visibleColumns.length} 
                      className="px-4 py-8 text-center text-muted-foreground"
                    >
                      No data available
                    </td>
                  </tr>
                ) : (
                  data.map((item, index) => (
                    <tr key={index} className="border-b hover:bg-muted/20">
                      {visibleColumns.map((column) => (
                        <td
                          key={column.key}
                          className={`px-4 py-3 text-sm ${
                            column.numeric ? 'text-right' : 'text-left'
                          }`}
                        >
                          {renderCell 
                            ? renderCell(item, column)
                            : formatCellValue(item[column.key], column)
                          }
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalItems > 0 && (
        <div className="flex flex-col space-y-4 sm:flex-row sm:items-center sm:justify-between sm:space-y-0">
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2">
              <span className="text-sm text-muted-foreground">Rows per page:</span>
              <Select
                value={pageSize.toString()}
                onValueChange={(value) => onPageSizeChange?.(parseInt(value))}
              >
                <SelectTrigger className="w-[80px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="25">25</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                  <SelectItem value="100">100</SelectItem>
                  <SelectItem value="200">200</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="text-sm text-muted-foreground">
              Showing {startItem} to {endItem} of {totalItems} entries
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPageChange?.(page - 1)}
              disabled={page <= 1 || loading}
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </Button>
            
            <div className="flex items-center space-x-1">
              {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                let pageNum
                if (totalPages <= 5) {
                  pageNum = i + 1
                } else if (page <= 3) {
                  pageNum = i + 1
                } else if (page >= totalPages - 2) {
                  pageNum = totalPages - 4 + i
                } else {
                  pageNum = page - 2 + i
                }

                return (
                  <Button
                    key={pageNum}
                    variant={page === pageNum ? "default" : "outline"}
                    size="sm"
                    className="w-8 h-8 p-0"
                    onClick={() => onPageChange?.(pageNum)}
                    disabled={loading}
                  >
                    {pageNum}
                  </Button>
                )
              })}
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => onPageChange?.(page + 1)}
              disabled={page >= totalPages || loading}
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}