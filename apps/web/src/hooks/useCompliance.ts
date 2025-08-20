import { useSupabase } from './useSupabase';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export interface TTBPeriod {
  id: string;
  type: 'monthly' | 'quarterly';
  period_start: string;
  period_end: string;
  status: 'open' | 'draft' | 'finalized';
  due_date: string;
  ttb_entries?: TTBEntry[];
}

export interface TTBEntry {
  id: string;
  line_code: string;
  category: string;
  quantity_bbl: number;
  owner_entity_id?: string;
  notes?: string;
}

export interface ExciseWorksheet {
  id: string;
  period_start: string;
  period_end: string;
  filing_frequency: 'semi_monthly' | 'quarterly' | 'annual';
  net_taxable_bbl: number;
  cbma_allocation_used_bbl: number;
  rate_bands: any[];
  amount_due_cents: number;
  finalized_at?: string;
}

export interface InBondTransfer {
  id: string;
  doc_number: string;
  shipper_entity_id: string;
  receiver_entity_id: string;
  same_ownership: boolean;
  shipped_at: string;
  received_at?: string;
  container_type: 'keg' | 'case' | 'bulk';
  total_barrels: number;
  docs_url?: string;
  remarks?: string;
}

export function useCompliance(workspaceId: string) {
  const supabase = useSupabase();
  const queryClient = useQueryClient();

  // Fetch current TTB periods
  const ttbPeriods = useQuery({
    queryKey: ['ttb-periods', workspaceId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ttb_periods')
        .select('*, ttb_entries(*)')
        .eq('workspace_id', workspaceId)
        .order('period_start', { ascending: false });

      if (error) throw error;
      return data as TTBPeriod[];
    },
  });

  // Fetch excise worksheets
  const exciseWorksheets = useQuery({
    queryKey: ['excise-worksheets', workspaceId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('excise_worksheets')
        .select('*')
        .eq('workspace_id', workspaceId)
        .order('period_start', { ascending: false });

      if (error) throw error;
      return data as ExciseWorksheet[];
    },
  });

  // Fetch in-bond transfers
  const transfers = useQuery({
    queryKey: ['transfers', workspaceId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inbond_transfers')
        .select(`
          *,
          shipper:shipper_entity_id(name, ttb_permit_number),
          receiver:receiver_entity_id(name, ttb_permit_number)
        `)
        .eq('workspace_id', workspaceId)
        .order('shipped_at', { ascending: false });

      if (error) throw error;
      return data as InBondTransfer[];
    },
  });

  // Create TTB period
  const createPeriod = useMutation({
    mutationFn: async (params: {
      type: 'monthly' | 'quarterly';
      period_start: Date;
      period_end: Date;
    }) => {
      const { data, error } = await supabase.rpc('create_ttb_period', {
        p_type: params.type,
        p_period_start: params.period_start.toISOString().split('T')[0],
        p_period_end: params.period_end.toISOString().split('T')[0],
      });

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ttb-periods'] });
    },
  });

  // Generate BROP
  const generateBROP = useMutation({
    mutationFn: async (params: {
      period_id: string;
      finalize?: boolean;
      dry_run?: boolean;
    }) => {
      const { data, error } = await supabase.rpc('generate_ttb_period', {
        p_period_id: params.period_id,
        p_finalize: params.finalize || false,
        p_dry_run: params.dry_run || false,
      });

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ttb-periods'] });
      queryClient.invalidateQueries({ queryKey: ['ttb-entries'] });
    },
  });

  // Build excise worksheet
  const buildExcise = useMutation({
    mutationFn: async (params: {
      period_start: Date;
      period_end: Date;
      dry_run?: boolean;
    }) => {
      const { data, error } = await supabase.rpc('build_excise_worksheet', {
        p_period_start: params.period_start.toISOString().split('T')[0],
        p_period_end: params.period_end.toISOString().split('T')[0],
        p_workspace_id: workspaceId,
        p_dry_run: params.dry_run || false,
      });

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['excise-worksheets'] });
    },
  });

  // Create in-bond transfer
  const createTransfer = useMutation({
    mutationFn: async (params: {
      shipper_entity_id: string;
      receiver_entity_id: string;
      same_ownership: boolean;
      shipped_at: Date;
      container_type: 'keg' | 'case' | 'bulk';
      lines: Array<{
        finished_lot_id?: string;
        bulk_reference?: string;
        qty: number;
        uom: string;
      }>;
      remarks?: string;
    }) => {
      const { data, error } = await supabase.rpc('create_inbond_transfer', {
        p_data: {
          ...params,
          shipped_at: params.shipped_at.toISOString().split('T')[0],
        },
        p_dry_run: false,
      });

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transfers'] });
    },
  });

  // Process sales ingest
  const processSalesIngest = useMutation({
    mutationFn: async (job_id: string) => {
      const { data, error } = await supabase.rpc('process_sales_ingest', {
        p_job_id: job_id,
      });

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sales-ingest-jobs'] });
      queryClient.invalidateQueries({ queryKey: ['removals'] });
    },
  });

  // Generate BROP PDF
  const generateBROPPDF = useMutation({
    mutationFn: async (period_id: string) => {
      const response = await fetch('/api/compliance/brop/pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ period_id }),
      });

      if (!response.ok) {
        throw new Error('Failed to generate PDF');
      }

      return response.json();
    },
  });

  // Generate transfer PDF
  const generateTransferPDF = useMutation({
    mutationFn: async (transfer_id: string) => {
      const response = await fetch('/api/compliance/transfer/pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transfer_id }),
      });

      if (!response.ok) {
        throw new Error('Failed to generate PDF');
      }

      return response.json();
    },
  });

  return {
    // Data
    ttbPeriods: ttbPeriods.data || [],
    exciseWorksheets: exciseWorksheets.data || [],
    transfers: transfers.data || [],
    
    // Loading states
    isLoadingPeriods: ttbPeriods.isLoading,
    isLoadingExcise: exciseWorksheets.isLoading,
    isLoadingTransfers: transfers.isLoading,
    
    // Mutations
    createPeriod,
    generateBROP,
    buildExcise,
    createTransfer,
    processSalesIngest,
    generateBROPPDF,
    generateTransferPDF,
    
    // Refetch functions
    refetchPeriods: ttbPeriods.refetch,
    refetchExcise: exciseWorksheets.refetch,
    refetchTransfers: transfers.refetch,
  };
}