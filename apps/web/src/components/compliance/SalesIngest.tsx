'use client';

import { useState, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@brewcrush/ui';
import { Button } from '@brewcrush/ui';
import { Badge } from '@brewcrush/ui';
import { Alert, AlertDescription } from '@brewcrush/ui';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@brewcrush/ui';
import { Progress } from '@brewcrush/ui';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@brewcrush/ui';
import { 
  Upload, 
  Download, 
  FileText, 
  CheckCircle,
  XCircle,
  AlertTriangle,
  Play,
  RotateCcw,
  FileSpreadsheet
} from 'lucide-react';
import { format } from 'date-fns';
import { useSupabase } from '@/hooks/useSupabase';
import { useDropzone } from 'react-dropzone';

interface SalesIngestProps {
  workspaceId: string;
}

interface IngestJob {
  id: string;
  upload_id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'completed_with_errors';
  total_rows: number;
  processed_rows: number;
  failed_rows: number;
  created_at: Date;
  completed_at?: Date;
}

export function SalesIngest({ workspaceId }: SalesIngestProps) {
  const supabase = useSupabase();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedPreset, setSelectedPreset] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentJob, setCurrentJob] = useState<IngestJob | null>(null);

  // Mock data for recent jobs
  const recentJobs: IngestJob[] = [
    {
      id: '1',
      upload_id: 'upload-001',
      status: 'completed',
      total_rows: 150,
      processed_rows: 150,
      failed_rows: 0,
      created_at: new Date('2025-01-28'),
      completed_at: new Date('2025-01-28')
    },
    {
      id: '2',
      upload_id: 'upload-002',
      status: 'completed_with_errors',
      total_rows: 200,
      processed_rows: 195,
      failed_rows: 5,
      created_at: new Date('2025-01-25'),
      completed_at: new Date('2025-01-25')
    },
    {
      id: '3',
      upload_id: 'upload-003',
      status: 'processing',
      total_rows: 100,
      processed_rows: 45,
      failed_rows: 0,
      created_at: new Date('2025-01-30')
    }
  ];

  const mappingPresets = [
    { id: 'custom', name: 'Custom Mapping', description: 'Configure field mappings manually' },
    { id: 'square', name: 'Square POS', description: 'Pre-configured for Square CSV exports' },
    { id: 'toast', name: 'Toast POS', description: 'Pre-configured for Toast reports' },
    { id: 'ekos', name: 'Ekos Brewmaster', description: 'Compatible with Ekos sales exports' },
    { id: 'beer30', name: 'Beer30', description: 'Import from Beer30 sales reports' }
  ];

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      setSelectedFile(acceptedFiles[0]);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'text/csv': ['.csv'],
      'application/vnd.ms-excel': ['.xls'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx']
    },
    maxFiles: 1
  });

  const handleProcess = async () => {
    if (!selectedFile || !selectedPreset) return;

    setIsProcessing(true);
    try {
      // Upload file to Edge Function
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('preset', selectedPreset);
      formData.append('group_taproom', 'true'); // Group taproom sales by day

      // Get the auth token
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error('No active session');
      }

      // Call the Edge Function
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/sales-ingest-csv`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: formData,
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to process file');
      }

      const result = await response.json();
      
      // Create a new job for the UI
      setCurrentJob({
        id: result.job_id,
        upload_id: selectedFile.name,
        status: result.failed_rows === 0 ? 'completed' : 'completed_with_errors',
        total_rows: result.total_rows,
        processed_rows: result.processed_rows,
        failed_rows: result.failed_rows,
        created_at: new Date(),
        completed_at: new Date(),
      });

      // Show success message
      if (result.failed_rows === 0) {
        alert(`Successfully processed ${result.processed_rows} rows`);
      } else {
        alert(`Processed ${result.processed_rows} rows with ${result.failed_rows} errors. Download the error report for details.`);
      }

      // Reset form
      setSelectedFile(null);
      setSelectedPreset('');
      
      // Refresh jobs list (in real app, would fetch from DB)
      
    } catch (error: any) {
      console.error('Error processing sales ingest:', error);
      alert(`Error: ${error.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <Badge variant="success"><CheckCircle className="h-3 w-3 mr-1" />Completed</Badge>;
      case 'completed_with_errors':
        return <Badge variant="warning"><AlertTriangle className="h-3 w-3 mr-1" />Completed with Errors</Badge>;
      case 'processing':
        return <Badge variant="secondary"><RotateCcw className="h-3 w-3 mr-1 animate-spin" />Processing</Badge>;
      case 'failed':
        return <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" />Failed</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getProgress = (job: IngestJob) => {
    if (job.total_rows === 0) return 0;
    return Math.round((job.processed_rows / job.total_rows) * 100);
  };

  return (
    <div className="space-y-6">
      {/* Header Card */}
      <Card>
        <CardHeader>
          <CardTitle>Sales Data Ingest</CardTitle>
          <CardDescription>
            Import POS sales data to automatically post removals for TTB reporting
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Button variant="outline">
              <Download className="h-4 w-4 mr-2" />
              Download Template
            </Button>
            <Button variant="outline">
              <FileText className="h-4 w-4 mr-2" />
              View Instructions
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Upload Section */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Import Sales Data</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* File Upload */}
          <div>
            <div
              {...getRootProps()}
              className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors
                ${isDragActive ? 'border-primary bg-primary/5' : 'border-gray-300 hover:border-gray-400'}`}
            >
              <input {...getInputProps()} />
              <Upload className="h-12 w-12 mx-auto mb-4 text-gray-400" />
              {selectedFile ? (
                <div className="space-y-2">
                  <p className="font-semibold">{selectedFile.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {(selectedFile.size / 1024).toFixed(2)} KB
                  </p>
                  <Button variant="outline" size="sm" onClick={(e) => {
                    e.stopPropagation();
                    setSelectedFile(null);
                  }}>
                    Remove
                  </Button>
                </div>
              ) : (
                <>
                  <p className="font-semibold">Drop your sales file here, or click to browse</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Supports CSV, XLS, and XLSX files
                  </p>
                </>
              )}
            </div>
          </div>

          {/* Mapping Preset Selection */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Select Mapping Preset</label>
            <Select value={selectedPreset} onValueChange={setSelectedPreset}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a POS system or custom mapping" />
              </SelectTrigger>
              <SelectContent>
                {mappingPresets.map(preset => (
                  <SelectItem key={preset.id} value={preset.id}>
                    <div>
                      <div className="font-medium">{preset.name}</div>
                      <div className="text-xs text-muted-foreground">{preset.description}</div>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Process Button */}
          <div className="flex justify-end">
            <Button 
              onClick={handleProcess}
              disabled={!selectedFile || !selectedPreset || isProcessing}
            >
              {isProcessing ? (
                <>
                  <RotateCcw className="h-4 w-4 mr-2 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 mr-2" />
                  Process Import
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Recent Jobs */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Recent Import Jobs</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>File</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Progress</TableHead>
                <TableHead className="text-right">Rows</TableHead>
                <TableHead className="text-right">Errors</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recentJobs.map(job => (
                <TableRow key={job.id}>
                  <TableCell>{format(job.created_at, 'MMM dd, yyyy HH:mm')}</TableCell>
                  <TableCell className="font-mono text-sm">{job.upload_id}</TableCell>
                  <TableCell>{getStatusBadge(job.status)}</TableCell>
                  <TableCell>
                    {job.status === 'processing' ? (
                      <div className="w-24">
                        <Progress value={getProgress(job)} className="h-2" />
                      </div>
                    ) : (
                      <span className="text-sm text-muted-foreground">
                        {job.completed_at ? format(job.completed_at, 'HH:mm:ss') : '-'}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {job.processed_rows} / {job.total_rows}
                  </TableCell>
                  <TableCell className="text-right">
                    {job.failed_rows > 0 ? (
                      <span className="text-red-600 font-semibold">{job.failed_rows}</span>
                    ) : (
                      <span className="text-green-600">0</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {job.failed_rows > 0 && (
                      <Button variant="ghost" size="sm">
                        <Download className="h-4 w-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Instructions */}
      <Alert>
        <FileSpreadsheet className="h-4 w-4" />
        <AlertDescription>
          <strong>CSV Format Requirements:</strong>
          <ul className="list-disc list-inside mt-2 space-y-1">
            <li>Date (YYYY-MM-DD or MM/DD/YYYY)</li>
            <li>SKU Code (must match your finished goods SKUs)</li>
            <li>Quantity (numeric)</li>
            <li>Unit of Measure (cases, kegs, etc.)</li>
            <li>Destination Type (taproom, distributor, export)</li>
            <li>Document Reference (invoice number, optional)</li>
          </ul>
        </AlertDescription>
      </Alert>
    </div>
  );
}