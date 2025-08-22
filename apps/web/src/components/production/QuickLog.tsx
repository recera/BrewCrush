'use client';

import { useState, useEffect, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@brewcrush/ui';
import {
  Button,
  Badge,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Card,
  CardContent,
} from '@brewcrush/ui';
import {
  Thermometer,
  Droplet,
  FlaskConical,
  Save,
  X,
  TrendingUp,
  TrendingDown,
  Minus,
  Delete,
  Clock,
  WifiOff,
  Camera,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { useOfflineQueue } from '@/hooks/useOfflineQueue';

interface QuickLogProps {
  batchId: string;
  batchNumber: string;
  tankName?: string;
  currentSG?: number;
  currentTemp?: number;
  currentPH?: number;
  lastReading?: {
    sg?: number;
    temp?: number;
    ph?: number;
    reading_at: string;
  };
  onClose: () => void;
  onSave?: () => void;
}

type MeasurementType = 'sg' | 'temp' | 'ph';

interface NumericKeypadProps {
  value: string;
  onChange: (value: string) => void;
  onClear: () => void;
  decimalPlaces?: number;
  min?: number;
  max?: number;
}

const NumericKeypad: React.FC<NumericKeypadProps> = ({
  value,
  onChange,
  onClear,
  decimalPlaces = 3,
  min,
  max,
}) => {
  const handleDigit = (digit: string) => {
    if (digit === '.' && value.includes('.')) return;
    
    // Check decimal places
    if (value.includes('.')) {
      const parts = value.split('.');
      if (parts[1].length >= decimalPlaces) return;
    }
    
    const newValue = value === '0' && digit !== '.' ? digit : value + digit;
    
    // Validate range
    const numValue = parseFloat(newValue);
    if (!isNaN(numValue)) {
      if (min !== undefined && numValue < min) return;
      if (max !== undefined && numValue > max) return;
    }
    
    onChange(newValue);
  };

  const handleBackspace = () => {
    if (value.length > 0) {
      onChange(value.slice(0, -1) || '0');
    }
  };

  return (
    <div className="grid grid-cols-3 gap-2 max-w-[280px] mx-auto">
      {['7', '8', '9'].map(digit => (
        <Button
          key={digit}
          variant="outline"
          size="lg"
          className="h-14 text-xl font-semibold"
          onClick={() => handleDigit(digit)}
        >
          {digit}
        </Button>
      ))}
      {['4', '5', '6'].map(digit => (
        <Button
          key={digit}
          variant="outline"
          size="lg"
          className="h-14 text-xl font-semibold"
          onClick={() => handleDigit(digit)}
        >
          {digit}
        </Button>
      ))}
      {['1', '2', '3'].map(digit => (
        <Button
          key={digit}
          variant="outline"
          size="lg"
          className="h-14 text-xl font-semibold"
          onClick={() => handleDigit(digit)}
        >
          {digit}
        </Button>
      ))}
      <Button
        variant="outline"
        size="lg"
        className="h-14 text-xl font-semibold"
        onClick={() => handleDigit('0')}
      >
        0
      </Button>
      <Button
        variant="outline"
        size="lg"
        className="h-14 text-xl font-semibold"
        onClick={() => handleDigit('.')}
      >
        .
      </Button>
      <Button
        variant="outline"
        size="lg"
        className="h-14"
        onClick={handleBackspace}
      >
        <Delete className="h-5 w-5" />
      </Button>
      <Button
        variant="destructive"
        size="lg"
        className="h-14 col-span-3"
        onClick={onClear}
      >
        Clear
      </Button>
    </div>
  );
};

interface SparklineProps {
  data: { value: number; date: string }[];
  type: 'sg' | 'temp' | 'ph';
  currentValue?: number;
}

const Sparkline: React.FC<SparklineProps> = ({ data, type, currentValue }) => {
  if (!data || data.length === 0) {
    return (
      <div className="h-16 flex items-center justify-center text-muted-foreground text-sm">
        No historical data
      </div>
    );
  }

  const values = data.map(d => d.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  
  // Add current value if provided
  if (currentValue !== undefined) {
    values.push(currentValue);
  }

  const points = values.map((value, index) => {
    const x = (index / (values.length - 1)) * 100;
    const y = 100 - ((value - min) / range) * 100;
    return `${x},${y}`;
  }).join(' ');

  const trend = values.length > 1 ? values[values.length - 1] - values[0] : 0;

  return (
    <div className="relative h-16">
      <svg 
        viewBox="0 0 100 100" 
        className="w-full h-full"
        preserveAspectRatio="none"
      >
        <polyline
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="text-primary"
          points={points}
        />
        {currentValue !== undefined && (
          <circle
            cx="100"
            cy={100 - ((currentValue - min) / range) * 100}
            r="3"
            className="fill-primary"
          />
        )}
      </svg>
      <div className="absolute top-0 right-0 flex items-center gap-1 text-xs">
        {trend > 0 ? (
          <TrendingUp className="h-3 w-3 text-green-600" />
        ) : trend < 0 ? (
          <TrendingDown className="h-3 w-3 text-red-600" />
        ) : (
          <Minus className="h-3 w-3 text-muted-foreground" />
        )}
        <span className="font-medium">
          {type === 'sg' ? values[values.length - 1].toFixed(3) :
           type === 'temp' ? `${values[values.length - 1].toFixed(1)}°` :
           values[values.length - 1].toFixed(2)}
        </span>
      </div>
    </div>
  );
};

export function QuickLog({
  batchId,
  batchNumber,
  tankName,
  currentSG,
  currentTemp,
  currentPH,
  lastReading,
  onClose,
  onSave,
}: QuickLogProps) {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { addToQueue, isOffline, queueSize } = useOfflineQueue();
  
  const [activeTab, setActiveTab] = useState<MeasurementType>('sg');
  const [sgValue, setSgValue] = useState(currentSG?.toString() || '1.000');
  const [tempValue, setTempValue] = useState(currentTemp?.toString() || '20.0');
  const [phValue, setPhValue] = useState(currentPH?.toString() || '5.0');
  const [notes, setNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Mock historical data for sparkline (in real app, fetch from database)
  const mockHistoricalData = {
    sg: [
      { value: 1.048, date: '2024-01-15' },
      { value: 1.042, date: '2024-01-16' },
      { value: 1.035, date: '2024-01-17' },
      { value: 1.028, date: '2024-01-18' },
      { value: 1.020, date: '2024-01-19' },
    ],
    temp: [
      { value: 18.5, date: '2024-01-15' },
      { value: 19.0, date: '2024-01-16' },
      { value: 19.2, date: '2024-01-17' },
      { value: 18.8, date: '2024-01-18' },
      { value: 19.0, date: '2024-01-19' },
    ],
    ph: [
      { value: 5.2, date: '2024-01-15' },
      { value: 5.1, date: '2024-01-16' },
      { value: 5.0, date: '2024-01-17' },
      { value: 4.9, date: '2024-01-18' },
      { value: 4.8, date: '2024-01-19' },
    ],
  };

  const saveFermReading = useMutation({
    mutationFn: async (data: {
      batch_id: string;
      sg: number | null;
      temp: number | null;
      ph: number | null;
      notes: string | null;
      reading_at: string;
    }) => {
      if (isOffline) {
        // Add to offline queue
        addToQueue({
          type: 'ferm_reading',
          data,
          timestamp: new Date().toISOString(),
        });
        return { success: true, offline: true };
      }

      const { error } = await supabase
        .from('ferm_readings')
        .insert(data);

      if (error) throw error;
      return { success: true, offline: false };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['batch', batchId] });
      queryClient.invalidateQueries({ queryKey: ['ferm-readings', batchId] });
      
      if (result.offline) {
        toast.info('Reading saved offline and will sync when connected');
      } else {
        toast.success('Fermentation reading saved');
      }
      
      onSave?.();
      onClose();
    },
    onError: (error: any) => {
      toast.error(`Failed to save reading: ${error.message}`);
    },
  });

  const handleSave = async () => {
    setIsSaving(true);
    
    try {
      await saveFermReading.mutateAsync({
        batch_id: batchId,
        sg: sgValue ? parseFloat(sgValue) : null,
        temp: tempValue ? parseFloat(tempValue) : null,
        ph: phValue ? parseFloat(phValue) : null,
        notes: notes || null,
        reading_at: new Date().toISOString(),
      });
    } finally {
      setIsSaving(false);
    }
  };

  const getTabIcon = (type: MeasurementType) => {
    switch (type) {
      case 'sg':
        return <Droplet className="h-4 w-4" />;
      case 'temp':
        return <Thermometer className="h-4 w-4" />;
      case 'ph':
        return <FlaskConical className="h-4 w-4" />;
    }
  };

  const getTabLabel = (type: MeasurementType) => {
    switch (type) {
      case 'sg':
        return 'Gravity';
      case 'temp':
        return 'Temperature';
      case 'ph':
        return 'pH';
    }
  };

  const getValueDisplay = (type: MeasurementType) => {
    switch (type) {
      case 'sg':
        return sgValue;
      case 'temp':
        return `${tempValue}°C`;
      case 'ph':
        return phValue;
    }
  };

  const getCurrentValue = (type: MeasurementType) => {
    switch (type) {
      case 'sg':
        return sgValue;
      case 'temp':
        return tempValue;
      case 'ph':
        return phValue;
    }
  };

  const setCurrentValue = (type: MeasurementType, value: string) => {
    switch (type) {
      case 'sg':
        setSgValue(value);
        break;
      case 'temp':
        setTempValue(value);
        break;
      case 'ph':
        setPhValue(value);
        break;
    }
  };

  const clearCurrentValue = (type: MeasurementType) => {
    switch (type) {
      case 'sg':
        setSgValue('1.000');
        break;
      case 'temp':
        setTempValue('20.0');
        break;
      case 'ph':
        setPhValue('5.0');
        break;
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md p-0 gap-0">
        <DialogHeader className="p-6 pb-0">
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="text-xl">Quick Log</DialogTitle>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant="outline">{batchNumber}</Badge>
                {tankName && (
                  <span className="text-sm text-muted-foreground">{tankName}</span>
                )}
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          
          {/* Offline indicator */}
          {isOffline && (
            <div className="flex items-center gap-2 mt-3 p-2 bg-amber-50 dark:bg-amber-950 rounded-lg">
              <WifiOff className="h-4 w-4 text-amber-600" />
              <span className="text-sm text-amber-600">
                Offline - {queueSize} queued
              </span>
            </div>
          )}

          {/* Last reading info */}
          {lastReading && (
            <div className="mt-3 p-2 bg-muted rounded-lg">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                Last reading: {format(new Date(lastReading.reading_at), 'MMM d, h:mm a')}
              </div>
              <div className="flex gap-3 mt-1 text-sm">
                {lastReading.sg && <span>SG: {lastReading.sg.toFixed(3)}</span>}
                {lastReading.temp && <span>Temp: {lastReading.temp}°C</span>}
                {lastReading.ph && <span>pH: {lastReading.ph}</span>}
              </div>
            </div>
          )}
        </DialogHeader>

        <div className="p-6">
          {/* Measurement tabs */}
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as MeasurementType)}>
            <TabsList className="grid w-full grid-cols-3">
              {(['sg', 'temp', 'ph'] as MeasurementType[]).map(type => (
                <TabsTrigger 
                  key={type}
                  value={type}
                  className="flex items-center gap-2"
                >
                  {getTabIcon(type)}
                  <span className="hidden sm:inline">{getTabLabel(type)}</span>
                </TabsTrigger>
              ))}
            </TabsList>

            {(['sg', 'temp', 'ph'] as MeasurementType[]).map(type => (
              <TabsContent key={type} value={type} className="space-y-4 mt-4">
                {/* Current value display */}
                <Card>
                  <CardContent className="pt-6">
                    <div className="text-center">
                      <div className="text-4xl font-bold mb-2">
                        {getValueDisplay(type)}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        Current {getTabLabel(type)}
                      </div>
                    </div>
                    
                    {/* Sparkline */}
                    <div className="mt-4">
                      <Sparkline
                        data={mockHistoricalData[type]}
                        type={type}
                        currentValue={parseFloat(getCurrentValue(type))}
                      />
                    </div>
                  </CardContent>
                </Card>

                {/* Numeric keypad */}
                <NumericKeypad
                  value={getCurrentValue(type)}
                  onChange={(value) => setCurrentValue(type, value)}
                  onClear={() => clearCurrentValue(type)}
                  decimalPlaces={type === 'sg' ? 3 : type === 'ph' ? 2 : 1}
                  min={type === 'sg' ? 0.990 : type === 'temp' ? -5 : 0}
                  max={type === 'sg' ? 1.200 : type === 'temp' ? 40 : 14}
                />
              </TabsContent>
            ))}
          </Tabs>

          {/* Notes input */}
          <div className="mt-4">
            <label className="text-sm font-medium">Notes (optional)</label>
            <textarea
              className="w-full mt-1 p-2 border rounded-lg resize-none"
              rows={2}
              placeholder="Add any observations..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter className="p-6 pt-0">
          <Button
            variant="outline"
            onClick={onClose}
            disabled={isSaving}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={isSaving}
            className="gap-2"
          >
            <Save className="h-4 w-4" />
            {isSaving ? 'Saving...' : 'Save Reading'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}