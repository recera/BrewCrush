'use client';

import { useMemo } from 'react';
import {
  LineChart,
  Line,
  Area,
  AreaChart,
  ComposedChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
  ReferenceArea,
  Dot,
  Label,
} from 'recharts';
import { format, parseISO } from 'date-fns';
import { Badge } from '@brewcrush/ui';
import { Card, CardContent, CardHeader, CardTitle } from '@brewcrush/ui';
import { Alert, AlertDescription } from '@brewcrush/ui';
import { AlertTriangle, TrendingDown, TrendingUp, CheckCircle, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface FermentationReading {
  id: string;
  reading_at: string;
  sg?: number | null;
  temp?: number | null;
  ph?: number | null;
  notes?: string | null;
}

interface QASpecs {
  target_og?: number;
  target_fg?: number;
  target_abv?: number;
  target_ibu?: number;
  temp_min?: number;
  temp_max?: number;
  ph_min?: number;
  ph_max?: number;
  sg_range?: {
    min: number;
    max: number;
  };
}

interface FermentationChartProps {
  readings: FermentationReading[];
  qaSpecs?: QASpecs;
  batchStatus: string;
  showAnomalies?: boolean;
  className?: string;
}

interface Anomaly {
  type: 'temperature' | 'gravity' | 'ph';
  severity: 'warning' | 'critical';
  message: string;
  reading: FermentationReading;
}

export function FermentationChart({
  readings,
  qaSpecs,
  batchStatus,
  showAnomalies = true,
  className,
}: FermentationChartProps) {
  // Process readings for chart
  const chartData = useMemo(() => {
    if (!readings || readings.length === 0) return [];
    
    return readings
      .sort((a, b) => new Date(a.reading_at).getTime() - new Date(b.reading_at).getTime())
      .map(reading => ({
        date: reading.reading_at,
        sg: reading.sg || null,
        temp: reading.temp || null,
        ph: reading.ph || null,
        notes: reading.notes,
      }));
  }, [readings]);

  // Detect anomalies based on QA specs
  const anomalies = useMemo((): Anomaly[] => {
    if (!qaSpecs || !showAnomalies || !readings) return [];
    
    const detectedAnomalies: Anomaly[] = [];
    
    readings.forEach(reading => {
      // Temperature anomalies
      if (reading.temp !== null && reading.temp !== undefined) {
        if (qaSpecs.temp_min && reading.temp < qaSpecs.temp_min) {
          detectedAnomalies.push({
            type: 'temperature',
            severity: reading.temp < qaSpecs.temp_min - 2 ? 'critical' : 'warning',
            message: `Temperature ${reading.temp}°C is below minimum ${qaSpecs.temp_min}°C`,
            reading,
          });
        }
        if (qaSpecs.temp_max && reading.temp > qaSpecs.temp_max) {
          detectedAnomalies.push({
            type: 'temperature',
            severity: reading.temp > qaSpecs.temp_max + 2 ? 'critical' : 'warning',
            message: `Temperature ${reading.temp}°C exceeds maximum ${qaSpecs.temp_max}°C`,
            reading,
          });
        }
      }
      
      // pH anomalies
      if (reading.ph !== null && reading.ph !== undefined) {
        if (qaSpecs.ph_min && reading.ph < qaSpecs.ph_min) {
          detectedAnomalies.push({
            type: 'ph',
            severity: reading.ph < qaSpecs.ph_min - 0.3 ? 'critical' : 'warning',
            message: `pH ${reading.ph} is below minimum ${qaSpecs.ph_min}`,
            reading,
          });
        }
        if (qaSpecs.ph_max && reading.ph > qaSpecs.ph_max) {
          detectedAnomalies.push({
            type: 'ph',
            severity: reading.ph > qaSpecs.ph_max + 0.3 ? 'critical' : 'warning',
            message: `pH ${reading.ph} exceeds maximum ${qaSpecs.ph_max}`,
            reading,
          });
        }
      }
      
      // Gravity anomalies (stalled fermentation detection)
      if (reading.sg !== null && reading.sg !== undefined && batchStatus === 'fermenting') {
        const readingIndex = readings.indexOf(reading);
        if (readingIndex > 2) {
          const prevReadings = readings.slice(readingIndex - 3, readingIndex);
          const gravityChange = Math.abs(
            prevReadings[0].sg! - reading.sg
          );
          
          // Check for stalled fermentation (no change in 3 readings)
          if (gravityChange < 0.002 && reading.sg > (qaSpecs.target_fg || 1.010) + 0.005) {
            detectedAnomalies.push({
              type: 'gravity',
              severity: 'warning',
              message: `Possible stalled fermentation - gravity unchanged at ${reading.sg.toFixed(3)}`,
              reading,
            });
          }
        }
      }
    });
    
    return detectedAnomalies;
  }, [readings, qaSpecs, batchStatus, showAnomalies]);

  // Custom tooltip
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload || !payload.length) return null;
    
    return (
      <div className="bg-background border rounded-lg p-3 shadow-lg">
        <p className="font-medium mb-1">
          {format(parseISO(label), 'MMM d, h:mm a')}
        </p>
        {payload.map((entry: any, index: number) => {
          if (entry.value === null) return null;
          return (
            <p key={index} className="text-sm" style={{ color: entry.color }}>
              {entry.name}: {entry.value.toFixed(entry.name === 'SG' ? 3 : 1)}
              {entry.name === 'Temp' && '°C'}
            </p>
          );
        })}
      </div>
    );
  };

  // Custom dot to highlight anomalies
  const CustomDot = (props: any) => {
    const { cx, cy, payload, dataKey } = props;
    
    // Check if this point has an anomaly
    const hasAnomaly = anomalies.some(a => {
      const readingDate = new Date(a.reading.reading_at).toISOString();
      const payloadDate = new Date(payload.date).toISOString();
      return readingDate === payloadDate && 
        ((a.type === 'temperature' && dataKey === 'temp') ||
         (a.type === 'gravity' && dataKey === 'sg') ||
         (a.type === 'ph' && dataKey === 'ph'));
    });
    
    if (hasAnomaly) {
      return (
        <circle
          cx={cx}
          cy={cy}
          r={6}
          fill="red"
          stroke="white"
          strokeWidth={2}
        />
      );
    }
    
    return <circle cx={cx} cy={cy} r={3} fill={props.fill} />;
  };

  if (!chartData || chartData.length === 0) {
    return (
      <Card className={className}>
        <CardContent className="pt-6">
          <div className="text-center text-muted-foreground">
            No fermentation readings available
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className={cn("space-y-4", className)}>
      {/* Anomaly Alerts */}
      {anomalies.length > 0 && (
        <Alert variant={anomalies.some(a => a.severity === 'critical') ? 'destructive' : 'default'}>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <div className="font-medium mb-1">Quality Control Alerts</div>
            <ul className="list-disc list-inside space-y-1 text-sm">
              {anomalies.slice(0, 3).map((anomaly, index) => (
                <li key={index} className={cn(
                  anomaly.severity === 'critical' && "text-destructive"
                )}>
                  {anomaly.message}
                </li>
              ))}
              {anomalies.length > 3 && (
                <li className="text-muted-foreground">
                  ...and {anomalies.length - 3} more alerts
                </li>
              )}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {/* Gravity Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Specific Gravity</span>
            {qaSpecs?.target_fg && (
              <Badge variant="outline" className="font-normal">
                Target FG: {qaSpecs.target_fg.toFixed(3)}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={250}>
            <AreaChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
              <defs>
                <linearGradient id="gravityGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis 
                dataKey="date" 
                tickFormatter={(date) => format(parseISO(date), 'MM/dd')}
                className="text-xs"
              />
              <YAxis 
                domain={['dataMin - 0.005', 'dataMax + 0.005']}
                tickFormatter={(value) => value.toFixed(3)}
                className="text-xs"
              />
              <Tooltip content={<CustomTooltip />} />
              
              {/* QA Spec Reference Lines */}
              {qaSpecs?.target_og && (
                <ReferenceLine 
                  y={qaSpecs.target_og} 
                  stroke="#22c55e" 
                  strokeDasharray="5 5"
                  label={{ value: "OG Target", position: "right", className: "text-xs fill-green-600" }}
                />
              )}
              {qaSpecs?.target_fg && (
                <ReferenceLine 
                  y={qaSpecs.target_fg} 
                  stroke="#ef4444" 
                  strokeDasharray="5 5"
                  label={{ value: "FG Target", position: "right", className: "text-xs fill-red-600" }}
                />
              )}
              
              <Area
                type="monotone"
                dataKey="sg"
                stroke="#8b5cf6"
                strokeWidth={2}
                fill="url(#gravityGradient)"
                dot={<CustomDot fill="#8b5cf6" />}
                name="SG"
              />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Temperature Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Temperature</span>
            {qaSpecs?.temp_min && qaSpecs?.temp_max && (
              <Badge variant="outline" className="font-normal">
                Target: {qaSpecs.temp_min}-{qaSpecs.temp_max}°C
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={250}>
            <ComposedChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis 
                dataKey="date" 
                tickFormatter={(date) => format(parseISO(date), 'MM/dd')}
                className="text-xs"
              />
              <YAxis 
                domain={['dataMin - 1', 'dataMax + 1']}
                tickFormatter={(value) => `${value}°`}
                className="text-xs"
              />
              <Tooltip content={<CustomTooltip />} />
              
              {/* Temperature Range Overlay */}
              {qaSpecs?.temp_min && qaSpecs?.temp_max && (
                <ReferenceArea
                  y1={qaSpecs.temp_min}
                  y2={qaSpecs.temp_max}
                  fill="#22c55e"
                  fillOpacity={0.1}
                  label={{ value: "Optimal Range", position: "insideTopRight", className: "text-xs fill-green-600" }}
                />
              )}
              
              <Line
                type="monotone"
                dataKey="temp"
                stroke="#f97316"
                strokeWidth={2}
                dot={<CustomDot fill="#f97316" />}
                name="Temp"
              />
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* pH Chart (if readings available) */}
      {chartData.some(d => d.ph !== null) && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>pH</span>
              {qaSpecs?.ph_min && qaSpecs?.ph_max && (
                <Badge variant="outline" className="font-normal">
                  Target: {qaSpecs.ph_min}-{qaSpecs.ph_max}
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis 
                  dataKey="date" 
                  tickFormatter={(date) => format(parseISO(date), 'MM/dd')}
                  className="text-xs"
                />
                <YAxis 
                  domain={[3, 7]}
                  tickFormatter={(value) => value.toFixed(1)}
                  className="text-xs"
                />
                <Tooltip content={<CustomTooltip />} />
                
                {/* pH Range Overlay */}
                {qaSpecs?.ph_min && qaSpecs?.ph_max && (
                  <ReferenceArea
                    y1={qaSpecs.ph_min}
                    y2={qaSpecs.ph_max}
                    fill="#3b82f6"
                    fillOpacity={0.1}
                    label={{ value: "Optimal pH", position: "insideTopRight", className: "text-xs fill-blue-600" }}
                  />
                )}
                
                <Line
                  type="monotone"
                  dataKey="ph"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  dot={<CustomDot fill="#3b82f6" />}
                  name="pH"
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Statistics Summary */}
      <Card>
        <CardHeader>
          <CardTitle>Fermentation Statistics</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {/* Current/Latest Values */}
            {chartData.length > 0 && (
              <>
                {chartData[chartData.length - 1].sg && (
                  <div>
                    <div className="text-sm text-muted-foreground">Current SG</div>
                    <div className="text-2xl font-bold">
                      {chartData[chartData.length - 1].sg.toFixed(3)}
                    </div>
                    {qaSpecs?.target_fg && (
                      <div className="text-xs text-muted-foreground">
                        Target: {qaSpecs.target_fg.toFixed(3)}
                      </div>
                    )}
                  </div>
                )}
                
                {chartData[chartData.length - 1].temp && (
                  <div>
                    <div className="text-sm text-muted-foreground">Current Temp</div>
                    <div className="text-2xl font-bold">
                      {chartData[chartData.length - 1].temp.toFixed(1)}°C
                    </div>
                    {qaSpecs?.temp_min && qaSpecs?.temp_max && (
                      <div className="text-xs text-muted-foreground">
                        Target: {qaSpecs.temp_min}-{qaSpecs.temp_max}°C
                      </div>
                    )}
                  </div>
                )}
                
                {/* Attenuation */}
                {chartData[0].sg && chartData[chartData.length - 1].sg && qaSpecs?.target_og && (
                  <div>
                    <div className="text-sm text-muted-foreground">Attenuation</div>
                    <div className="text-2xl font-bold">
                      {(
                        ((qaSpecs.target_og - chartData[chartData.length - 1].sg) / 
                        (qaSpecs.target_og - 1.000)) * 100
                      ).toFixed(1)}%
                    </div>
                  </div>
                )}
                
                {/* Days Fermenting */}
                <div>
                  <div className="text-sm text-muted-foreground">Days</div>
                  <div className="text-2xl font-bold">
                    {Math.ceil(
                      (new Date().getTime() - new Date(chartData[0].date).getTime()) / 
                      (1000 * 60 * 60 * 24)
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}