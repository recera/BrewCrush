'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation } from '@tanstack/react-query';
import { 
  Play, 
  Pause, 
  Check, 
  X, 
  Clock, 
  Droplets, 
  Thermometer,
  FlaskConical,
  Package,
  AlertCircle,
  WifiOff,
  Wifi,
  ChevronLeft,
  Timer,
  DollarSign,
  Plus,
  Minus,
} from 'lucide-react';
import { Button } from '@brewcrush/ui';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@brewcrush/ui';
import { Badge } from '@brewcrush/ui';
import { Progress } from '@brewcrush/ui';
import { Alert, AlertDescription } from '@brewcrush/ui';
import { Input } from '@brewcrush/ui';
import { Textarea } from '@brewcrush/ui';
import { ScrollArea } from '@brewcrush/ui';
import { createClient } from '@/lib/supabase/client';
import { BatchTimeline, RecipeStep } from '@/types/production';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import { 
  addToOutbox, 
  saveTimer, 
  getTimersByBatch, 
  updateTimer,
  deleteTimer,
  saveBrewDayState,
  getBrewDayState,
  clearBrewDayState,
} from '@/lib/offline/db';
import { useOfflineQueue } from '@/lib/offline/sync';
import { LotOverrideDialog } from '@/components/brew-day/LotOverrideDialog';
import { MeasurementDialog } from '@/components/brew-day/MeasurementDialog';

interface BrewDayTimer {
  id: string;
  name: string;
  duration: number;
  startTime?: number;
  isPaused: boolean;
  remainingTime?: number;
  completed: boolean;
}

interface BrewDayStep extends RecipeStep {
  completed?: boolean;
  completedAt?: string;
  notes?: string;
}

export default function BrewDayPage() {
  const params = useParams();
  const router = useRouter();
  const batchId = params.id as string;
  const { queueCount, isOnline } = useOfflineQueue();
  
  const supabase = createClient();
  const [currentStep, setCurrentStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<Set<string>>(new Set());
  const [timers, setTimers] = useState<BrewDayTimer[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [showLotOverride, setShowLotOverride] = useState(false);
  const [showMeasurement, setShowMeasurement] = useState(false);
  const [measurements, setMeasurements] = useState<Record<string, any>>({});

  // Fetch batch and recipe details
  const { data: batch, isLoading: batchLoading } = useQuery({
    queryKey: ['brew-day-batch', batchId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_batch_timeline')
        .select('*')
        .eq('id', batchId)
        .single();

      if (error) throw error;
      return data as BatchTimeline;
    },
  });

  // Fetch recipe steps
  const { data: recipeSteps, isLoading: stepsLoading } = useQuery({
    queryKey: ['brew-day-steps', batch?.recipe_version_id],
    queryFn: async () => {
      if (!batch?.recipe_version_id) return [];
      
      const { data, error } = await supabase
        .from('recipe_steps')
        .select('*')
        .eq('recipe_version_id', batch.recipe_version_id)
        .order('step_number');

      if (error) throw error;
      return data as BrewDayStep[];
    },
    enabled: !!batch?.recipe_version_id,
  });

  // Fetch ingredients for this batch
  const { data: ingredients } = useQuery({
    queryKey: ['brew-day-ingredients', batch?.recipe_version_id],
    queryFn: async () => {
      if (!batch?.recipe_version_id) return [];
      
      const { data, error } = await supabase
        .from('recipe_ingredients')
        .select(`
          *,
          item:items(*)
        `)
        .eq('recipe_version_id', batch.recipe_version_id)
        .eq('phase', 'mash')
        .order('sort_order');

      if (error) throw error;
      return data;
    },
    enabled: !!batch?.recipe_version_id,
  });

  // Load saved state from IndexedDB
  useEffect(() => {
    const loadSavedState = async () => {
      if (!batchId) return;

      // Load timers
      const savedTimers = await getTimersByBatch(batchId);
      if (savedTimers.length > 0) {
        setTimers(savedTimers as BrewDayTimer[]);
      }

      // Load brew day state
      const savedState = await getBrewDayState(batchId);
      if (savedState) {
        setCurrentStep(savedState.currentStep);
        setCompletedSteps(new Set(savedState.completedSteps));
        setMeasurements(savedState.measurements);
        setNotes(savedState.notes);
      }
    };

    loadSavedState();
  }, [batchId]);

  // Save state to IndexedDB whenever it changes
  useEffect(() => {
    if (!batchId) return;

    const saveState = async () => {
      await saveBrewDayState({
        batchId,
        currentStep,
        completedSteps: Array.from(completedSteps),
        measurements,
        notes,
        startedAt: Date.now(),
        lastUpdated: Date.now(),
      });
    };

    saveState();
  }, [batchId, currentStep, completedSteps, measurements, notes]);

  // Timer management
  const startTimer = useCallback(async (name: string, duration: number) => {
    const timer: BrewDayTimer = {
      id: crypto.randomUUID(),
      name,
      duration,
      startTime: Date.now(),
      isPaused: false,
      completed: false,
    };

    await saveTimer({
      ...timer,
      batchId,
      remainingTime: duration,
    });

    setTimers(prev => [...prev, timer]);
  }, [batchId]);

  const pauseTimer = useCallback(async (timerId: string) => {
    const timer = timers.find(t => t.id === timerId);
    if (!timer || !timer.startTime) return;

    const elapsed = (Date.now() - timer.startTime) / 1000;
    const remaining = Math.max(0, timer.duration - elapsed);

    await updateTimer(timerId, {
      isPaused: true,
      pausedAt: Date.now(),
      remainingTime: remaining,
    });

    setTimers(prev => prev.map(t => 
      t.id === timerId 
        ? { ...t, isPaused: true, remainingTime: remaining }
        : t
    ));
  }, [timers]);

  const resumeTimer = useCallback(async (timerId: string) => {
    const timer = timers.find(t => t.id === timerId);
    if (!timer || !timer.remainingTime) return;

    await updateTimer(timerId, {
      isPaused: false,
      startTime: Date.now(),
      duration: timer.remainingTime,
    });

    setTimers(prev => prev.map(t => 
      t.id === timerId 
        ? { ...t, isPaused: false, startTime: Date.now(), duration: timer.remainingTime }
        : t
    ));
  }, [timers]);

  const completeTimer = useCallback(async (timerId: string) => {
    await updateTimer(timerId, { completed: true });
    
    setTimers(prev => prev.map(t => 
      t.id === timerId 
        ? { ...t, completed: true }
        : t
    ));

    // Add to outbox for sync
    const user = await supabase.auth.getUser();
    if (user.data.user) {
      await addToOutbox({
        operation: 'timer.complete',
        payload: { timerId, batchId },
        workspaceId: batch?.workspace_id || '',
        userId: user.data.user.id,
      });
    }
  }, [batch, batchId, supabase]);

  // Step management
  const completeStep = useCallback(async (stepId: string) => {
    setCompletedSteps(prev => new Set([...prev, stepId]));
    
    // Move to next step if completing current
    const steps = recipeSteps || [];
    const currentStepData = steps[currentStep];
    if (currentStepData?.id === stepId && currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    }
  }, [currentStep, recipeSteps]);

  const addNote = useCallback((note: string) => {
    if (!note.trim()) return;
    setNotes(prev => [...prev, note]);
  }, []);

  // Measurement recording
  const recordMeasurement = useCallback(async (type: string, value: any) => {
    setMeasurements(prev => ({ ...prev, [type]: value }));
    
    // Add to outbox for sync
    const user = await supabase.auth.getUser();
    if (user.data.user) {
      await addToOutbox({
        operation: 'batch.update_measurements',
        payload: {
          batch_id: batchId,
          [`actual_${type}`]: value,
        },
        workspaceId: batch?.workspace_id || '',
        userId: user.data.user.id,
      });
    }
  }, [batch, batchId, supabase]);

  // Timer update effect
  useEffect(() => {
    const interval = setInterval(() => {
      setTimers(prev => prev.map(timer => {
        if (timer.completed || timer.isPaused || !timer.startTime) {
          return timer;
        }

        const elapsed = (Date.now() - timer.startTime) / 1000;
        const remaining = Math.max(0, timer.duration - elapsed);

        if (remaining === 0 && !timer.completed) {
          // Timer completed
          completeTimer(timer.id);
          // Play sound or vibrate
          if ('vibrate' in navigator) {
            navigator.vibrate([200, 100, 200]);
          }
        }

        return { ...timer, remainingTime: remaining };
      }));
    }, 1000);

    return () => clearInterval(interval);
  }, [completeTimer]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getProgress = () => {
    if (!recipeSteps || recipeSteps.length === 0) return 0;
    return (completedSteps.size / recipeSteps.length) * 100;
  };

  const isLoading = batchLoading || stepsLoading;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background p-4 flex items-center justify-center">
        <div className="text-center">
          <FlaskConical className="h-12 w-12 animate-pulse mx-auto mb-4" />
          <p className="text-muted-foreground">Loading brew day...</p>
        </div>
      </div>
    );
  }

  if (!batch || batch.status !== 'brewing') {
    return (
      <div className="min-h-screen bg-background p-4">
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            This batch is not in brewing status. Please start brew day first.
          </AlertDescription>
        </Alert>
        <Button 
          className="mt-4"
          onClick={() => router.push(`/batches`)}
        >
          Back to Batches
        </Button>
      </div>
    );
  }

  const steps = recipeSteps || [];
  const currentStepData = steps[currentStep];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-0 z-50 bg-background border-b">
        <div className="flex items-center justify-between p-4">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => router.push('/batches')}
            >
              <ChevronLeft className="h-6 w-6" />
            </Button>
            <div>
              <h1 className="text-xl font-bold">{batch.batch_number}</h1>
              <p className="text-sm text-muted-foreground">{batch.recipe_name}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={isOnline ? "default" : "secondary"}>
              {isOnline ? (
                <><Wifi className="h-3 w-3 mr-1" /> Online</>
              ) : (
                <><WifiOff className="h-3 w-3 mr-1" /> Offline</>
              )}
            </Badge>
            {queueCount > 0 && (
              <Badge variant="outline">
                {queueCount} queued
              </Badge>
            )}
          </div>
        </div>
        
        {/* Progress Bar */}
        <Progress value={getProgress()} className="h-2" />
      </div>

      {/* Main Content */}
      <ScrollArea className="h-[calc(100vh-120px)]">
        <div className="p-4 space-y-4 pb-20">
          {/* Quick Actions */}
          <div className="grid grid-cols-2 gap-3">
            <Button
              size="lg"
              variant="outline"
              className="h-20 text-base"
              onClick={() => setShowMeasurement(true)}
            >
              <Droplets className="mr-2 h-5 w-5" />
              Record OG
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="h-20 text-base"
              onClick={() => setShowLotOverride(true)}
            >
              <Package className="mr-2 h-5 w-5" />
              Override Lots
            </Button>
          </div>

          {/* Current Step */}
          {currentStepData && (
            <Card className="border-primary">
              <CardHeader>
                <div className="flex justify-between items-start">
                  <div>
                    <CardTitle className="text-lg">
                      Step {currentStepData.step_number}: {currentStepData.name}
                    </CardTitle>
                    <CardDescription className="mt-2">
                      {currentStepData.description}
                    </CardDescription>
                  </div>
                  <Badge>{currentStepData.phase}</Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {/* Step parameters */}
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    {currentStepData.duration_minutes && (
                      <div className="flex items-center gap-2">
                        <Clock className="h-4 w-4 text-muted-foreground" />
                        <span>{currentStepData.duration_minutes} min</span>
                      </div>
                    )}
                    {currentStepData.temperature && (
                      <div className="flex items-center gap-2">
                        <Thermometer className="h-4 w-4 text-muted-foreground" />
                        <span>{currentStepData.temperature}°{currentStepData.temperature_unit || 'C'}</span>
                      </div>
                    )}
                  </div>

                  {/* Timer for this step */}
                  {currentStepData.duration_minutes && (
                    <Button
                      size="lg"
                      className="w-full h-14 text-lg"
                      onClick={() => startTimer(
                        currentStepData.name,
                        currentStepData.duration_minutes * 60
                      )}
                    >
                      <Timer className="mr-2 h-5 w-5" />
                      Start {currentStepData.duration_minutes} min Timer
                    </Button>
                  )}

                  {/* Complete step button */}
                  <Button
                    size="lg"
                    variant="default"
                    className="w-full h-14 text-lg"
                    onClick={() => completeStep(currentStepData.id)}
                    disabled={completedSteps.has(currentStepData.id)}
                  >
                    {completedSteps.has(currentStepData.id) ? (
                      <>
                        <Check className="mr-2 h-5 w-5" />
                        Completed
                      </>
                    ) : (
                      <>
                        <Check className="mr-2 h-5 w-5" />
                        Complete Step
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Active Timers */}
          {timers.filter(t => !t.completed).length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Active Timers</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {timers.filter(t => !t.completed).map(timer => (
                  <div
                    key={timer.id}
                    className="flex items-center justify-between p-3 bg-muted rounded-lg"
                  >
                    <div className="flex-1">
                      <p className="font-medium">{timer.name}</p>
                      <p className="text-2xl font-mono mt-1">
                        {formatTime(timer.remainingTime || timer.duration)}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      {timer.isPaused ? (
                        <Button
                          size="icon"
                          variant="outline"
                          onClick={() => resumeTimer(timer.id)}
                        >
                          <Play className="h-4 w-4" />
                        </Button>
                      ) : (
                        <Button
                          size="icon"
                          variant="outline"
                          onClick={() => pauseTimer(timer.id)}
                        >
                          <Pause className="h-4 w-4" />
                        </Button>
                      )}
                      <Button
                        size="icon"
                        variant="destructive"
                        onClick={() => completeTimer(timer.id)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* All Steps */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">All Steps</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {steps.map((step, index) => (
                  <div
                    key={step.id}
                    className={`flex items-center justify-between p-3 rounded-lg border ${
                      index === currentStep ? 'border-primary bg-primary/5' : ''
                    }`}
                    onClick={() => setCurrentStep(index)}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                        completedSteps.has(step.id)
                          ? 'bg-green-500 text-white'
                          : index === currentStep
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted'
                      }`}>
                        {completedSteps.has(step.id) ? (
                          <Check className="h-4 w-4" />
                        ) : (
                          <span className="text-sm">{step.step_number}</span>
                        )}
                      </div>
                      <div>
                        <p className="font-medium">{step.name}</p>
                        <p className="text-sm text-muted-foreground">{step.phase}</p>
                      </div>
                    </div>
                    {step.duration_minutes && (
                      <span className="text-sm text-muted-foreground">
                        {step.duration_minutes} min
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Notes */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Notes</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <Textarea
                  placeholder="Add a note..."
                  className="resize-none"
                  rows={3}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      const value = (e.target as HTMLTextAreaElement).value;
                      if (value) {
                        addNote(value);
                        (e.target as HTMLTextAreaElement).value = '';
                      }
                    }
                  }}
                />
                {notes.length > 0 && (
                  <div className="space-y-2">
                    {notes.map((note, index) => (
                      <div key={index} className="p-2 bg-muted rounded text-sm">
                        {note}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </ScrollArea>

      {/* Dialogs */}
      {showLotOverride && ingredients && (
        <LotOverrideDialog
          ingredients={ingredients}
          batchId={batchId}
          open={showLotOverride}
          onOpenChange={setShowLotOverride}
        />
      )}

      {showMeasurement && (
        <MeasurementDialog
          batch={batch}
          open={showMeasurement}
          onOpenChange={setShowMeasurement}
          onSave={recordMeasurement}
        />
      )}
    </div>
  );
}