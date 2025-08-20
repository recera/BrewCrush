'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Badge } from '@/components/ui/badge'
import { Save, FolderOpen, Trash2, Edit, MoreVertical } from 'lucide-react'
import { useToast } from '@/components/ui/use-toast'

interface SavedView {
  id: string
  name: string
  description?: string
  report_type: string
  filters: Record<string, any>
  sort_config: {
    field: string
    direction: 'asc' | 'desc'
  }
  is_shared: boolean
  created_at: string
  created_by: string
}

interface SavedViewsManagerProps {
  reportType: string
  currentFilters?: Record<string, any>
  currentSort?: {
    field: string
    direction: 'asc' | 'desc'
  }
  onViewLoad?: (view: SavedView) => void
}

export function SavedViewsManager({
  reportType,
  currentFilters = {},
  currentSort = { field: 'created_at', direction: 'desc' },
  onViewLoad
}: SavedViewsManagerProps) {
  const [savedViews, setSavedViews] = useState<SavedView[]>([])
  const [loading, setLoading] = useState(false)
  const [saveDialogOpen, setSaveDialogOpen] = useState(false)
  const [loadDialogOpen, setLoadDialogOpen] = useState(false)
  const [editingView, setEditingView] = useState<SavedView | null>(null)

  // Save form state
  const [saveName, setSaveName] = useState('')
  const [saveDescription, setSaveDescription] = useState('')
  const [saveAsShared, setSaveAsShared] = useState(false)

  const supabase = createClient()
  const { toast } = useToast()

  useEffect(() => {
    loadSavedViews()
  }, [reportType])

  const loadSavedViews = async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('saved_report_views')
        .select('*')
        .eq('report_type', reportType)
        .order('created_at', { ascending: false })

      if (error) throw error
      setSavedViews(data || [])
    } catch (error: any) {
      console.error('Error loading saved views:', error)
      toast({
        title: 'Error loading saved views',
        description: error.message,
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  const saveCurrentView = async () => {
    if (!saveName.trim()) return

    try {
      const viewData = {
        name: saveName.trim(),
        description: saveDescription.trim() || null,
        report_type: reportType,
        filters: currentFilters,
        sort_config: currentSort,
        is_shared: saveAsShared
      }

      let error
      if (editingView) {
        // Update existing view
        const { error: updateError } = await supabase
          .from('saved_report_views')
          .update(viewData)
          .eq('id', editingView.id)
        error = updateError
      } else {
        // Create new view
        const { error: insertError } = await supabase
          .from('saved_report_views')
          .insert(viewData)
        error = insertError
      }

      if (error) throw error

      toast({
        title: editingView ? 'View updated' : 'View saved',
        description: `"${saveName}" has been ${editingView ? 'updated' : 'saved'} successfully.`,
      })

      // Reset form and close dialog
      setSaveName('')
      setSaveDescription('')
      setSaveAsShared(false)
      setEditingView(null)
      setSaveDialogOpen(false)

      // Reload views
      loadSavedViews()
    } catch (error: any) {
      console.error('Error saving view:', error)
      toast({
        title: 'Error saving view',
        description: error.message,
        variant: 'destructive',
      })
    }
  }

  const loadView = (view: SavedView) => {
    if (onViewLoad) {
      onViewLoad(view)
    }
    setLoadDialogOpen(false)
    toast({
      title: 'View loaded',
      description: `Applied filters and settings from "${view.name}".`,
    })
  }

  const deleteView = async (viewId: string) => {
    try {
      const { error } = await supabase
        .from('saved_report_views')
        .delete()
        .eq('id', viewId)

      if (error) throw error

      toast({
        title: 'View deleted',
        description: 'The saved view has been removed.',
      })

      loadSavedViews()
    } catch (error: any) {
      console.error('Error deleting view:', error)
      toast({
        title: 'Error deleting view',
        description: error.message,
        variant: 'destructive',
      })
    }
  }

  const editView = (view: SavedView) => {
    setEditingView(view)
    setSaveName(view.name)
    setSaveDescription(view.description || '')
    setSaveAsShared(view.is_shared)
    setSaveDialogOpen(true)
  }

  const hasActiveFilters = Object.keys(currentFilters).length > 0

  return (
    <div className="flex space-x-2">
      {/* Save View */}
      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <DialogTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            disabled={!hasActiveFilters}
            onClick={() => {
              setEditingView(null)
              setSaveName('')
              setSaveDescription('')
              setSaveAsShared(false)
            }}
          >
            <Save className="h-4 w-4 mr-2" />
            Save View
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingView ? 'Edit Saved View' : 'Save Current View'}
            </DialogTitle>
            <DialogDescription>
              Save your current filters and sorting for quick access later.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-2 block">Name</label>
              <Input
                placeholder="My Custom View"
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
              />
            </div>
            
            <div>
              <label className="text-sm font-medium mb-2 block">Description (Optional)</label>
              <Input
                placeholder="Brief description of this view..."
                value={saveDescription}
                onChange={(e) => setSaveDescription(e.target.value)}
              />
            </div>

            {/* Show current filters summary */}
            <div className="bg-muted/30 rounded-lg p-3">
              <div className="text-sm font-medium mb-2">Current Settings:</div>
              <div className="text-xs text-muted-foreground space-y-1">
                <div>Filters: {Object.keys(currentFilters).length} active</div>
                <div>Sort: {currentSort.field} ({currentSort.direction})</div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setSaveDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={saveCurrentView}
              disabled={!saveName.trim()}
            >
              {editingView ? 'Update View' : 'Save View'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Load View */}
      <Dialog open={loadDialogOpen} onOpenChange={setLoadDialogOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm">
            <FolderOpen className="h-4 w-4 mr-2" />
            Load View
            {savedViews.length > 0 && (
              <Badge variant="secondary" className="ml-2">
                {savedViews.length}
              </Badge>
            )}
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Load Saved View</DialogTitle>
            <DialogDescription>
              Choose a saved view to apply its filters and settings.
            </DialogDescription>
          </DialogHeader>
          
          <div className="max-h-96 overflow-y-auto">
            {loading ? (
              <div className="text-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
                <p className="text-sm text-muted-foreground mt-2">Loading views...</p>
              </div>
            ) : savedViews.length === 0 ? (
              <div className="text-center py-8">
                <FolderOpen className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-sm text-muted-foreground">No saved views yet</p>
              </div>
            ) : (
              <div className="space-y-2">
                {savedViews.map((view) => (
                  <div
                    key={view.id}
                    className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/30 cursor-pointer"
                    onClick={() => loadView(view)}
                  >
                    <div className="flex-1">
                      <div className="flex items-center space-x-2">
                        <h4 className="font-medium">{view.name}</h4>
                        {view.is_shared && (
                          <Badge variant="outline" className="text-xs">
                            Shared
                          </Badge>
                        )}
                      </div>
                      {view.description && (
                        <p className="text-sm text-muted-foreground mt-1">
                          {view.description}
                        </p>
                      )}
                      <div className="text-xs text-muted-foreground mt-1">
                        {Object.keys(view.filters).length} filters • 
                        Sort by {view.sort_config.field} • 
                        {new Date(view.created_at).toLocaleDateString()}
                      </div>
                    </div>
                    
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                        <Button variant="ghost" size="sm">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={(e) => {
                          e.stopPropagation()
                          editView(view)
                          setLoadDialogOpen(false)
                        }}>
                          <Edit className="h-4 w-4 mr-2" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem 
                          className="text-red-600"
                          onClick={(e) => {
                            e.stopPropagation()
                            deleteView(view.id)
                          }}
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}