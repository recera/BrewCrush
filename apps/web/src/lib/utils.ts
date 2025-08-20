import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatDate(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(d);
}

export function formatDateTime(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d);
}

export function formatNumber(num: number, decimals: number = 2): string {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(num);
}

export function formatPercentage(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value / 100);
}

export function formatVolume(liters: number): string {
  if (liters >= 1000) {
    return `${formatNumber(liters / 1000, 1)} kL`;
  }
  return `${formatNumber(liters, 1)} L`;
}

export function formatWeight(kg: number): string {
  if (kg < 1) {
    return `${formatNumber(kg * 1000, 0)} g`;
  }
  return `${formatNumber(kg, 2)} kg`;
}

export function calculateABV(og: number, fg: number): number {
  // Standard ABV formula
  return (og - fg) * 131.25;
}

export function sgToPlato(sg: number): number {
  // Convert specific gravity to degrees Plato
  return (-1 * 616.868) + (1111.14 * sg) - (630.272 * sg * sg) + (135.997 * sg * sg * sg);
}

export function platoToSG(plato: number): number {
  // Convert degrees Plato to specific gravity
  return 1 + (plato / (258.6 - ((plato / 258.2) * 227.1)));
}

export function generateBatchNumber(prefix?: string): string {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  
  if (prefix) {
    return `${prefix}-${year}${month}${day}-${random}`;
  }
  return `${year}${month}${day}-${random}`;
}

export function getDaysBetween(start: string | Date, end: string | Date = new Date()): number {
  const startDate = typeof start === 'string' ? new Date(start) : start;
  const endDate = typeof end === 'string' ? new Date(end) : end;
  const diffTime = Math.abs(endDate.getTime() - startDate.getTime());
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

export function getBatchStatusColor(status: string): string {
  const statusColors: Record<string, string> = {
    planned: 'bg-gray-500',
    brewing: 'bg-blue-500',
    fermenting: 'bg-amber-500',
    conditioning: 'bg-yellow-500',
    packaging: 'bg-purple-500',
    completed: 'bg-green-500',
    archived: 'bg-gray-400',
    cancelled: 'bg-red-500',
  };
  return statusColors[status] || 'bg-gray-500';
}

export function getTankStatusColor(status: string): string {
  const statusColors: Record<string, string> = {
    clean: 'bg-green-500',
    dirty: 'bg-yellow-500',
    in_progress: 'bg-blue-500',
    required: 'bg-red-500',
  };
  return statusColors[status] || 'bg-gray-500';
}