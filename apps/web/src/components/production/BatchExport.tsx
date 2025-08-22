'use client';

import { useState } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@brewcrush/ui';
import { Button } from '@brewcrush/ui';
import { Download, FileText, FileSpreadsheet, Printer, FileJson } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';

interface BatchData {
  id: string;
  batch_number: string;
  recipe_name?: string;
  recipe_style?: string;
  status: string;
  brew_date?: string;
  target_volume?: number;
  actual_volume?: number;
  target_og?: number;
  actual_og?: number;
  target_fg?: number;
  actual_fg?: number;
  target_abv?: number;
  actual_abv?: number;
  target_ibu?: number;
  tank_name?: string;
  ferment_start_date?: string;
  ferment_end_date?: string;
  package_date?: string;
  total_cost?: number;
  cost_per_liter?: number;
  notes?: string;
}

interface FermReading {
  id: string;
  reading_at: string;
  sg?: number;
  temp?: number;
  ph?: number;
  notes?: string;
  created_by?: string;
}

interface RecipeIngredient {
  item_name: string;
  qty: number;
  uom: string;
  phase?: string;
  timing?: string;
}

interface BatchExportProps {
  batch: BatchData;
  fermReadings?: FermReading[];
  ingredients?: RecipeIngredient[];
  className?: string;
}

export function BatchExport({ batch, fermReadings, ingredients, className }: BatchExportProps) {
  const [isExporting, setIsExporting] = useState(false);

  // Convert batch data to CSV
  const exportBatchCSV = () => {
    const headers = [
      'Batch Number',
      'Recipe',
      'Style',
      'Status',
      'Brew Date',
      'Target Volume (L)',
      'Actual Volume (L)',
      'Target OG',
      'Actual OG',
      'Target FG',
      'Actual FG',
      'Target ABV (%)',
      'Actual ABV (%)',
      'Target IBU',
      'Tank',
      'Fermentation Start',
      'Fermentation End',
      'Package Date',
      'Total Cost',
      'Cost per Liter',
      'Notes'
    ];

    const row = [
      batch.batch_number,
      batch.recipe_name || '',
      batch.recipe_style || '',
      batch.status,
      batch.brew_date ? format(new Date(batch.brew_date), 'yyyy-MM-dd') : '',
      batch.target_volume || '',
      batch.actual_volume || '',
      batch.target_og || '',
      batch.actual_og || '',
      batch.target_fg || '',
      batch.actual_fg || '',
      batch.target_abv || '',
      batch.actual_abv || '',
      batch.target_ibu || '',
      batch.tank_name || '',
      batch.ferment_start_date ? format(new Date(batch.ferment_start_date), 'yyyy-MM-dd') : '',
      batch.ferment_end_date ? format(new Date(batch.ferment_end_date), 'yyyy-MM-dd') : '',
      batch.package_date ? format(new Date(batch.package_date), 'yyyy-MM-dd') : '',
      batch.total_cost ? `$${batch.total_cost.toFixed(2)}` : '',
      batch.cost_per_liter ? `$${batch.cost_per_liter.toFixed(2)}` : '',
      batch.notes || ''
    ];

    const csv = [
      headers.join(','),
      row.map(value => `"${value}"`).join(',')
    ].join('\\n');

    downloadFile(csv, `batch-${batch.batch_number}.csv`, 'text/csv');
  };

  // Export fermentation readings to CSV
  const exportFermReadingsCSV = () => {
    if (!fermReadings || fermReadings.length === 0) {
      toast.error('No fermentation readings to export');
      return;
    }

    const headers = ['Date/Time', 'SG', 'Temperature (°C)', 'pH', 'Notes', 'Logged By'];
    
    const rows = fermReadings.map(reading => [
      format(new Date(reading.reading_at), 'yyyy-MM-dd HH:mm'),
      reading.sg?.toFixed(3) || '',
      reading.temp?.toFixed(1) || '',
      reading.ph?.toFixed(2) || '',
      reading.notes || '',
      reading.created_by || ''
    ]);

    const csv = [
      headers.join(','),
      ...rows.map(row => row.map(value => `"${value}"`).join(','))
    ].join('\\n');

    downloadFile(csv, `fermentation-${batch.batch_number}.csv`, 'text/csv');
  };

  // Export as JSON
  const exportJSON = () => {
    const data = {
      batch,
      fermReadings: fermReadings || [],
      ingredients: ingredients || [],
      exportedAt: new Date().toISOString()
    };

    const json = JSON.stringify(data, null, 2);
    downloadFile(json, `batch-${batch.batch_number}.json`, 'application/json');
  };

  // Generate printable batch sheet HTML
  const generateBatchSheet = () => {
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Batch Sheet - ${batch.batch_number}</title>
  <style>
    @media print {
      @page { margin: 0.5in; }
      .no-print { display: none; }
    }
    body {
      font-family: Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 8.5in;
      margin: 0 auto;
      padding: 20px;
    }
    h1, h2, h3 { margin-top: 0; }
    h1 { 
      border-bottom: 3px solid #333; 
      padding-bottom: 10px;
      margin-bottom: 20px;
    }
    h2 { 
      background: #f0f0f0; 
      padding: 8px; 
      margin: 20px 0 10px 0;
    }
    .header {
      display: flex;
      justify-content: space-between;
      margin-bottom: 20px;
    }
    .header-section {
      flex: 1;
    }
    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
      margin-bottom: 20px;
    }
    .field {
      margin-bottom: 10px;
    }
    .field-label {
      font-weight: bold;
      display: inline-block;
      min-width: 120px;
    }
    .field-value {
      display: inline-block;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 10px 0;
    }
    th, td {
      border: 1px solid #ddd;
      padding: 8px;
      text-align: left;
    }
    th {
      background: #f0f0f0;
      font-weight: bold;
    }
    .signature-section {
      margin-top: 40px;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 40px;
    }
    .signature-line {
      border-top: 1px solid #333;
      margin-top: 40px;
      padding-top: 5px;
      text-align: center;
    }
    .notes-section {
      border: 1px solid #ddd;
      padding: 10px;
      min-height: 100px;
      margin: 20px 0;
    }
    .checkbox {
      display: inline-block;
      width: 15px;
      height: 15px;
      border: 1px solid #333;
      margin-right: 10px;
      vertical-align: middle;
    }
  </style>
</head>
<body>
  <h1>Batch Production Sheet</h1>
  
  <div class="header">
    <div class="header-section">
      <div class="field">
        <span class="field-label">Batch Number:</span>
        <span class="field-value"><strong>${batch.batch_number}</strong></span>
      </div>
      <div class="field">
        <span class="field-label">Recipe:</span>
        <span class="field-value">${batch.recipe_name || 'N/A'}</span>
      </div>
      <div class="field">
        <span class="field-label">Style:</span>
        <span class="field-value">${batch.recipe_style || 'N/A'}</span>
      </div>
    </div>
    <div class="header-section">
      <div class="field">
        <span class="field-label">Brew Date:</span>
        <span class="field-value">${batch.brew_date ? format(new Date(batch.brew_date), 'PPP') : '_______________'}</span>
      </div>
      <div class="field">
        <span class="field-label">Status:</span>
        <span class="field-value">${batch.status}</span>
      </div>
      <div class="field">
        <span class="field-label">Tank:</span>
        <span class="field-value">${batch.tank_name || '_______________'}</span>
      </div>
    </div>
  </div>

  <h2>Target Specifications</h2>
  <div class="grid">
    <div>
      <div class="field">
        <span class="field-label">Target Volume:</span>
        <span class="field-value">${batch.target_volume || '___'}L</span>
      </div>
      <div class="field">
        <span class="field-label">Target OG:</span>
        <span class="field-value">${batch.target_og?.toFixed(3) || '1.___'}</span>
      </div>
      <div class="field">
        <span class="field-label">Target FG:</span>
        <span class="field-value">${batch.target_fg?.toFixed(3) || '1.___'}</span>
      </div>
    </div>
    <div>
      <div class="field">
        <span class="field-label">Target ABV:</span>
        <span class="field-value">${batch.target_abv?.toFixed(1) || '___'}%</span>
      </div>
      <div class="field">
        <span class="field-label">Target IBU:</span>
        <span class="field-value">${batch.target_ibu || '___'}</span>
      </div>
    </div>
  </div>

  ${ingredients && ingredients.length > 0 ? `
  <h2>Recipe Ingredients</h2>
  <table>
    <thead>
      <tr>
        <th>Ingredient</th>
        <th>Amount</th>
        <th>Unit</th>
        <th>Phase</th>
        <th>Added</th>
      </tr>
    </thead>
    <tbody>
      ${ingredients.map(ing => `
        <tr>
          <td>${ing.item_name}</td>
          <td>${ing.qty}</td>
          <td>${ing.uom}</td>
          <td>${ing.phase || '-'}</td>
          <td><span class="checkbox"></span></td>
        </tr>
      `).join('')}
    </tbody>
  </table>
  ` : ''}

  <h2>Actual Measurements</h2>
  <div class="grid">
    <div>
      <div class="field">
        <span class="field-label">Actual Volume:</span>
        <span class="field-value">___________ L</span>
      </div>
      <div class="field">
        <span class="field-label">Actual OG:</span>
        <span class="field-value">1.___________</span>
      </div>
      <div class="field">
        <span class="field-label">Mash pH:</span>
        <span class="field-value">___________</span>
      </div>
    </div>
    <div>
      <div class="field">
        <span class="field-label">Pre-boil Volume:</span>
        <span class="field-value">___________ L</span>
      </div>
      <div class="field">
        <span class="field-label">Pre-boil Gravity:</span>
        <span class="field-value">1.___________</span>
      </div>
      <div class="field">
        <span class="field-label">Boil pH:</span>
        <span class="field-value">___________</span>
      </div>
    </div>
  </div>

  <h2>Process Checklist</h2>
  <div style="margin: 10px 0;">
    <div style="margin-bottom: 8px;"><span class="checkbox"></span> Mill grains</div>
    <div style="margin-bottom: 8px;"><span class="checkbox"></span> Heat strike water to _____ °C</div>
    <div style="margin-bottom: 8px;"><span class="checkbox"></span> Mash in at _____ °C</div>
    <div style="margin-bottom: 8px;"><span class="checkbox"></span> Check mash pH (target: _____)</div>
    <div style="margin-bottom: 8px;"><span class="checkbox"></span> Vorlauf until clear</div>
    <div style="margin-bottom: 8px;"><span class="checkbox"></span> Collect wort</div>
    <div style="margin-bottom: 8px;"><span class="checkbox"></span> Begin boil</div>
    <div style="margin-bottom: 8px;"><span class="checkbox"></span> Add hops per schedule</div>
    <div style="margin-bottom: 8px;"><span class="checkbox"></span> Whirlpool</div>
    <div style="margin-bottom: 8px;"><span class="checkbox"></span> Chill to _____ °C</div>
    <div style="margin-bottom: 8px;"><span class="checkbox"></span> Transfer to fermenter</div>
    <div style="margin-bottom: 8px;"><span class="checkbox"></span> Pitch yeast</div>
    <div style="margin-bottom: 8px;"><span class="checkbox"></span> Record OG</div>
  </div>

  <h2>Fermentation Log</h2>
  <table>
    <thead>
      <tr>
        <th>Date</th>
        <th>Day</th>
        <th>SG</th>
        <th>Temp (°C)</th>
        <th>pH</th>
        <th>Notes</th>
        <th>Initials</th>
      </tr>
    </thead>
    <tbody>
      ${Array.from({length: 14}, (_, i) => `
        <tr>
          <td style="height: 30px;"></td>
          <td>${i + 1}</td>
          <td></td>
          <td></td>
          <td></td>
          <td></td>
          <td></td>
        </tr>
      `).join('')}
    </tbody>
  </table>

  <h2>Notes</h2>
  <div class="notes-section">
    ${batch.notes || ''}
  </div>

  <div class="signature-section">
    <div>
      <div>Brewed by:</div>
      <div class="signature-line">Signature / Date</div>
    </div>
    <div>
      <div>Verified by:</div>
      <div class="signature-line">Signature / Date</div>
    </div>
  </div>

  <div style="margin-top: 40px; text-align: center; color: #666; font-size: 12px;">
    Generated: ${format(new Date(), 'PPpp')} | BrewCrush Production System
  </div>
</body>
</html>
    `;

    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const newWindow = window.open(url, '_blank');
    
    if (newWindow) {
      newWindow.onload = () => {
        setTimeout(() => {
          newWindow.print();
        }, 500);
      };
    }
    
    toast.success('Batch sheet opened in new window');
  };

  // Helper function to download files
  const downloadFile = (content: string, filename: string, mimeType: string) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success(`Downloaded ${filename}`);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className={className} disabled={isExporting}>
          <Download className="mr-2 h-4 w-4" />
          Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Export Options</DropdownMenuLabel>
        <DropdownMenuSeparator />
        
        <DropdownMenuItem onClick={generateBatchSheet}>
          <Printer className="mr-2 h-4 w-4" />
          Print Batch Sheet
        </DropdownMenuItem>
        
        <DropdownMenuItem onClick={exportBatchCSV}>
          <FileSpreadsheet className="mr-2 h-4 w-4" />
          Batch Details (CSV)
        </DropdownMenuItem>
        
        {fermReadings && fermReadings.length > 0 && (
          <DropdownMenuItem onClick={exportFermReadingsCSV}>
            <FileSpreadsheet className="mr-2 h-4 w-4" />
            Fermentation Data (CSV)
          </DropdownMenuItem>
        )}
        
        <DropdownMenuItem onClick={exportJSON}>
          <FileJson className="mr-2 h-4 w-4" />
          Full Export (JSON)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}