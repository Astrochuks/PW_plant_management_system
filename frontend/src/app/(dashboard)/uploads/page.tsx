'use client';

import { useState, useRef, useMemo, useCallback } from 'react';
import { ProtectedRoute } from '@/components/protected-route';
import { useLocationsWithStats } from '@/hooks/use-locations';
import {
  usePreviewWeeklyReport,
  useConfirmWeeklyReport,
  type PreviewPlant,
  type PreviewResponse,
  type ConfirmedPlant,
  type MissingPlantAction,
} from '@/hooks/use-uploads';
import { getErrorMessage } from '@/lib/api/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  ArrowLeft,
  Search,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Loader2,
  X,
  Pencil,
} from 'lucide-react';
import { toast } from 'sonner';

// ============================================================================
// Constants
// ============================================================================

const PAGE_SIZE = 50;

const CONDITION_LABELS: Record<string, string> = {
  working: 'Working',
  standby: 'Standby',
  under_repair: 'Under Repair',
  breakdown: 'Breakdown',
  faulty: 'Faulty',
  off_hire: 'Off Hire',
  scrap: 'Scrap',
  missing: 'Missing',
  gpm_assessment: 'GPM Assessment',
  unverified: 'Unverified',
};

const CONDITION_COLORS: Record<string, string> = {
  working: 'bg-emerald-100 text-emerald-800',
  standby: 'bg-blue-100 text-blue-800',
  under_repair: 'bg-amber-100 text-amber-800',
  breakdown: 'bg-red-100 text-red-800',
  faulty: 'bg-orange-100 text-orange-800',
  off_hire: 'bg-slate-100 text-slate-800',
  scrap: 'bg-gray-100 text-gray-800',
  missing: 'bg-purple-100 text-purple-800',
  gpm_assessment: 'bg-orange-100 text-orange-800',
  unverified: 'bg-yellow-100 text-yellow-800',
};

// ============================================================================
// Upload Page
// ============================================================================

type Step = 'upload' | 'review' | 'success';

function UploadPageContent() {
  const [step, setStep] = useState<Step>('upload');
  const [previewData, setPreviewData] = useState<PreviewResponse | null>(null);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [editedConditions, setEditedConditions] = useState<Record<string, string>>({});
  const [editedTransferTo, setEditedTransferTo] = useState<Record<string, string>>({});
  const [editedTransferFrom, setEditedTransferFrom] = useState<Record<string, string>>({});
  const [missingActions, setMissingActions] = useState<Record<string, MissingPlantAction>>({});
  const [confirmResult, setConfirmResult] = useState<{ submissionId: string; count: number } | null>(null);

  const handlePreviewSuccess = useCallback((data: PreviewResponse, file: File) => {
    setPreviewData(data);
    setUploadedFile(file);
    setEditedConditions({});
    setEditedTransferTo({});
    setEditedTransferFrom({});
    setMissingActions({});
    setStep('review');
  }, []);

  const handleConfirmSuccess = useCallback((submissionId: string, count: number) => {
    setConfirmResult({ submissionId, count });
    setStep('success');
  }, []);

  const handleReset = useCallback(() => {
    setStep('upload');
    setPreviewData(null);
    setUploadedFile(null);
    setEditedConditions({});
    setEditedTransferTo({});
    setEditedTransferFrom({});
    setMissingActions({});
    setConfirmResult(null);
  }, []);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Weekly Report Upload</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Upload, review, and confirm weekly plant reports
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" asChild>
            <a href="/uploads/submissions">View Submissions</a>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <a href="/uploads/tokens">Manage Tokens</a>
          </Button>
        </div>
      </div>

      {/* Step Indicator */}
      <StepIndicator current={step} />

      {step === 'upload' && (
        <UploadStep onSuccess={handlePreviewSuccess} />
      )}

      {step === 'review' && previewData && (
        <ReviewStep
          data={previewData}
          file={uploadedFile}
          editedConditions={editedConditions}
          setEditedConditions={setEditedConditions}
          editedTransferTo={editedTransferTo}
          setEditedTransferTo={setEditedTransferTo}
          editedTransferFrom={editedTransferFrom}
          setEditedTransferFrom={setEditedTransferFrom}
          missingActions={missingActions}
          setMissingActions={setMissingActions}
          onBack={handleReset}
          onConfirmSuccess={handleConfirmSuccess}
        />
      )}

      {step === 'success' && confirmResult && previewData && (
        <SuccessStep
          submissionId={confirmResult.submissionId}
          count={confirmResult.count}
          locationName={previewData.location.name}
          locationId={previewData.location.id}
          week={previewData.week}
          onUploadAnother={handleReset}
        />
      )}
    </div>
  );
}

// ============================================================================
// Step Indicator
// ============================================================================

function StepIndicator({ current }: { current: Step }) {
  const steps = [
    { key: 'upload', label: 'Upload File' },
    { key: 'review', label: 'Review & Edit' },
    { key: 'success', label: 'Confirmed' },
  ] as const;

  const currentIdx = steps.findIndex((s) => s.key === current);

  return (
    <div className="flex items-center gap-2">
      {steps.map((s, i) => (
        <div key={s.key} className="flex items-center gap-2">
          <div
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium ${
              i === currentIdx
                ? 'bg-primary text-primary-foreground'
                : i < currentIdx
                ? 'bg-emerald-100 text-emerald-800'
                : 'bg-muted text-muted-foreground'
            }`}
          >
            <span>{i + 1}</span>
            <span>{s.label}</span>
          </div>
          {i < steps.length - 1 && (
            <div className={`w-8 h-px ${i < currentIdx ? 'bg-emerald-400' : 'bg-border'}`} />
          )}
        </div>
      ))}
    </div>
  );
}

// ============================================================================
// Step 1: Upload Form
// ============================================================================

function UploadStep({ onSuccess }: { onSuccess: (data: PreviewResponse, file: File) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [locationId, setLocationId] = useState('');
  const [weekEndingDate, setWeekEndingDate] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: locations, isLoading: locationsLoading } = useLocationsWithStats();
  const previewMutation = usePreviewWeeklyReport();

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile && (droppedFile.name.endsWith('.xlsx') || droppedFile.name.endsWith('.xls'))) {
      setFile(droppedFile);
    } else {
      toast.error('Please upload an Excel file (.xlsx or .xls)');
    }
  }, []);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) setFile(selected);
  }, []);

  const handlePreview = useCallback(() => {
    if (!file || !locationId || !weekEndingDate) return;

    previewMutation.mutate(
      { file, locationId, weekEndingDate },
      {
        onSuccess: (data) => {
          toast.success(`Preview loaded: ${data.summary.total_in_file} plants found`);
          onSuccess(data, file!);
        },
        onError: (error) => {
          toast.error(getErrorMessage(error));
        },
      }
    );
  }, [file, locationId, weekEndingDate, previewMutation, onSuccess]);

  const canPreview = file && locationId && weekEndingDate && !previewMutation.isPending;

  return (
    <Card>
      <CardContent className="p-6 space-y-6">
        {/* File Drop Zone */}
        <div>
          <Label className="text-sm font-medium mb-2 block">Excel File</Label>
          <div
            className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
              isDragging
                ? 'border-primary bg-primary/5'
                : file
                ? 'border-emerald-300 bg-emerald-50'
                : 'border-border hover:border-primary/50'
            }`}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={handleFileChange}
              className="hidden"
            />
            {file ? (
              <div className="flex items-center justify-center gap-3">
                <FileSpreadsheet className="h-8 w-8 text-emerald-600" />
                <div className="text-left">
                  <p className="font-medium text-sm">{file.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {(file.size / 1024).toFixed(1)} KB
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => { e.stopPropagation(); setFile(null); }}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <Upload className="h-10 w-10 text-muted-foreground mx-auto" />
                <p className="text-sm text-muted-foreground">
                  Drag and drop your Excel file here, or click to browse
                </p>
                <p className="text-xs text-muted-foreground">.xlsx or .xls files only</p>
              </div>
            )}
          </div>
        </div>

        {/* Location & Date */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="location" className="text-sm font-medium mb-2 block">Site / Location</Label>
            {locationsLoading ? (
              <Skeleton className="h-10 w-full" />
            ) : (
              <Select value={locationId} onValueChange={setLocationId}>
                <SelectTrigger id="location">
                  <SelectValue placeholder="Select site..." />
                </SelectTrigger>
                <SelectContent>
                  {(locations || []).map((loc) => (
                    <SelectItem key={loc.id} value={loc.id}>
                      {loc.location_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div>
            <Label htmlFor="week-ending" className="text-sm font-medium mb-2 block">Week Ending Date</Label>
            <Input
              id="week-ending"
              type="date"
              value={weekEndingDate}
              onChange={(e) => setWeekEndingDate(e.target.value)}
            />
          </div>
        </div>

        {/* Preview Button */}
        <div className="flex justify-end">
          <Button
            onClick={handlePreview}
            disabled={!canPreview}
            size="lg"
          >
            {previewMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Processing file...
              </>
            ) : (
              <>
                <Upload className="mr-2 h-4 w-4" />
                Preview Report
              </>
            )}
          </Button>
        </div>

        {previewMutation.isError && (
          <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-sm text-red-800">
            <AlertTriangle className="h-4 w-4 inline mr-2" />
            {getErrorMessage(previewMutation.error)}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Step 2: Review & Edit
// ============================================================================

interface ReviewStepProps {
  data: PreviewResponse;
  file: File | null;
  editedConditions: Record<string, string>;
  setEditedConditions: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  editedTransferTo: Record<string, string>;
  setEditedTransferTo: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  editedTransferFrom: Record<string, string>;
  setEditedTransferFrom: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  missingActions: Record<string, MissingPlantAction>;
  setMissingActions: React.Dispatch<React.SetStateAction<Record<string, MissingPlantAction>>>;
  onBack: () => void;
  onConfirmSuccess: (submissionId: string, count: number) => void;
}

function ReviewStep({
  data,
  file,
  editedConditions,
  setEditedConditions,
  editedTransferTo,
  setEditedTransferTo,
  editedTransferFrom,
  setEditedTransferFrom,
  missingActions,
  setMissingActions,
  onBack,
  onConfirmSuccess,
}: ReviewStepProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [confidenceFilter, setConfidenceFilter] = useState<string>('all');
  const [conditionFilter, setConditionFilter] = useState<string>('all');
  const [page, setPage] = useState(1);
  const [showMissing, setShowMissing] = useState(false);

  const confirmMutation = useConfirmWeeklyReport();

  // Apply filters
  const filteredPlants = useMemo(() => {
    let plants = data.plants;

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      plants = plants.filter(
        (p) =>
          p.fleet_number.toLowerCase().includes(q) ||
          (p.description && p.description.toLowerCase().includes(q))
      );
    }

    if (confidenceFilter !== 'all') {
      plants = plants.filter((p) => p.condition_confidence === confidenceFilter);
    }

    if (conditionFilter !== 'all') {
      plants = plants.filter((p) => {
        const effective = editedConditions[p.fleet_number] || p.detected_condition;
        return effective === conditionFilter;
      });
    }

    return plants;
  }, [data.plants, searchQuery, confidenceFilter, conditionFilter, editedConditions]);

  // Pagination
  const totalPages = Math.ceil(filteredPlants.length / PAGE_SIZE);
  const paginatedPlants = filteredPlants.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Reset page when filters change
  const handleFilterChange = useCallback((setter: (v: string) => void) => {
    return (value: string) => {
      setter(value);
      setPage(1);
    };
  }, []);

  // Edit counts
  const editCount = Object.keys(editedConditions).length;

  // Build confirm payload
  const handleConfirm = useCallback(() => {
    const plants: ConfirmedPlant[] = data.plants.map((p) => ({
      fleet_number: p.fleet_number,
      description: p.description,
      remarks: p.remarks,
      hours_worked: p.hours_worked,
      standby_hours: p.standby_hours,
      breakdown_hours: p.breakdown_hours,
      off_hire: p.off_hire,
      physical_verification: p.physical_verification,
      condition: editedConditions[p.fleet_number] || p.detected_condition,
      transfer_to_location_id: editedTransferTo[p.fleet_number] || p.detected_transfer_to_id,
      transfer_from_location_id: editedTransferFrom[p.fleet_number] || p.detected_transfer_from_id,
    }));

    const missingPlantActions = Object.values(missingActions).filter((a) => a.action !== 'keep');

    confirmMutation.mutate(
      {
        locationId: data.location.id,
        year: data.week.year,
        weekNumber: data.week.week_number,
        weekEndingDate: data.week.week_ending_date,
        plants,
        missingPlantActions: missingPlantActions.length > 0 ? missingPlantActions : undefined,
        file: file || undefined,
      },
      {
        onSuccess: (result) => {
          toast.success(result.message);
          onConfirmSuccess(result.submission_id, result.plants_count);
        },
        onError: (error) => {
          toast.error(getErrorMessage(error));
        },
      }
    );
  }, [data, editedConditions, editedTransferTo, editedTransferFrom, missingActions, confirmMutation, onConfirmSuccess]);

  return (
    <div className="space-y-4">
      {/* Header Bar */}
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back
        </Button>
        <div className="text-sm text-muted-foreground">
          {data.location.name} &mdash; Week {data.week.week_number}, {data.week.year}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <SummaryCard label="Total Plants" value={data.summary.total_in_file} />
        <SummaryCard label="New Plants" value={data.summary.new_this_week} color="emerald" />
        <SummaryCard label="Missing" value={data.summary.missing_from_previous} color="purple" />
        <SummaryCard label="High Confidence" value={data.summary.high_confidence} color="green" />
        <SummaryCard label="Medium" value={data.summary.medium_confidence} color="amber" />
        <SummaryCard label="Low (Review)" value={data.summary.low_confidence} color="red" />
      </div>

      {/* Condition Breakdown */}
      <div className="flex flex-wrap gap-1.5">
        {Object.entries(data.summary.condition_breakdown).map(([condition, count]) => (
          <Badge
            key={condition}
            variant="outline"
            className={`text-xs ${CONDITION_COLORS[condition] || ''}`}
          >
            {CONDITION_LABELS[condition] || condition}: {count}
          </Badge>
        ))}
        {editCount > 0 && (
          <Badge variant="outline" className="text-xs bg-blue-100 text-blue-800">
            {editCount} edited
          </Badge>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search fleet number..."
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
            className="pl-9"
          />
        </div>

        <Select value={confidenceFilter} onValueChange={handleFilterChange(setConfidenceFilter)}>
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Confidence</SelectItem>
            <SelectItem value="low">Low (Review)</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="high">High</SelectItem>
          </SelectContent>
        </Select>

        <Select value={conditionFilter} onValueChange={handleFilterChange(setConditionFilter)}>
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Conditions</SelectItem>
            {(data.condition_options || []).map((c) => (
              <SelectItem key={c} value={c}>{CONDITION_LABELS[c] || c}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <span className="text-xs text-muted-foreground">
          {filteredPlants.length} of {data.plants.length} plants
        </span>
      </div>

      {/* Preview Table */}
      <div className="border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[40px]">#</TableHead>
                <TableHead className="w-[110px]">Fleet No.</TableHead>
                <TableHead className="min-w-[150px]">Description</TableHead>
                <TableHead className="w-[70px] text-right">Worked</TableHead>
                <TableHead className="w-[70px] text-right">Standby</TableHead>
                <TableHead className="w-[70px] text-right">B/Down</TableHead>
                <TableHead className="w-[60px] text-center">Off Hire</TableHead>
                <TableHead className="w-[150px]">Condition</TableHead>
                <TableHead className="w-[80px] text-center">Confidence</TableHead>
                <TableHead className="min-w-[120px]">Transfer</TableHead>
                <TableHead className="min-w-[150px]">Remarks</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedPlants.map((plant, idx) => (
                <PlantRow
                  key={`${plant.fleet_number}-${idx}`}
                  plant={plant}
                  index={(page - 1) * PAGE_SIZE + idx + 1}
                  conditionOptions={data.condition_options}
                  availableLocations={data.available_locations}
                  editedCondition={editedConditions[plant.fleet_number]}
                  editedTransferTo={editedTransferTo[plant.fleet_number]}
                  editedTransferFrom={editedTransferFrom[plant.fleet_number]}
                  onConditionChange={(value) => {
                    setEditedConditions((prev) => {
                      if (value === plant.detected_condition) {
                        const next = { ...prev };
                        delete next[plant.fleet_number];
                        return next;
                      }
                      return { ...prev, [plant.fleet_number]: value };
                    });
                  }}
                  onTransferToChange={(value) => {
                    setEditedTransferTo((prev) => {
                      if (!value) {
                        const next = { ...prev };
                        delete next[plant.fleet_number];
                        return next;
                      }
                      return { ...prev, [plant.fleet_number]: value };
                    });
                  }}
                  onTransferFromChange={(value) => {
                    setEditedTransferFrom((prev) => {
                      if (!value) {
                        const next = { ...prev };
                        delete next[plant.fleet_number];
                        return next;
                      }
                      return { ...prev, [plant.fleet_number]: value };
                    });
                  }}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
              Prev
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Missing Plants Section */}
      {data.missing_plants.length > 0 && (
        <div className="border rounded-lg">
          <button
            className="w-full flex items-center justify-between p-4 text-left hover:bg-muted/50 transition-colors"
            onClick={() => setShowMissing(!showMissing)}
          >
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              <span className="font-medium text-sm">
                Missing Plants ({data.missing_plants.length})
              </span>
              <span className="text-xs text-muted-foreground">
                Plants from previous week not found in this file
              </span>
            </div>
            {showMissing ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </button>

          {showMissing && (
            <div className="border-t overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fleet No.</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Last Condition</TableHead>
                    <TableHead className="w-[180px]">Action</TableHead>
                    <TableHead className="w-[180px]">Transfer To</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.missing_plants.map((mp) => (
                    <MissingPlantRow
                      key={mp.fleet_number}
                      plant={mp}
                      action={missingActions[mp.fleet_number]}
                      availableLocations={data.available_locations}
                      onActionChange={(action) => {
                        setMissingActions((prev) => ({
                          ...prev,
                          [mp.fleet_number]: action,
                        }));
                      }}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      )}

      {/* Confirm Bar */}
      <div className="sticky bottom-0 bg-background border-t py-4 -mx-6 px-6 flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {data.plants.length} plants ready &middot;{' '}
          {editCount > 0 && <span className="text-blue-600">{editCount} edited &middot; </span>}
          {data.missing_plants.length > 0 && (
            <span className="text-amber-600">{data.missing_plants.length} missing</span>
          )}
        </div>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="lg" disabled={confirmMutation.isPending}>
              {confirmMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  Confirm & Save
                </>
              )}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Confirm Weekly Report</AlertDialogTitle>
              <AlertDialogDescription>
                This will save <strong>{data.plants.length} plant records</strong> for{' '}
                <strong>Week {data.week.week_number}, {data.week.year}</strong> at{' '}
                <strong>{data.location.name}</strong>.
                {editCount > 0 && (
                  <> You have edited {editCount} condition{editCount !== 1 ? 's' : ''}.</>
                )}
                {' '}This action will update the plants database.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleConfirm}>
                Confirm & Save
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}

// ============================================================================
// Plant Row
// ============================================================================

interface PlantRowProps {
  plant: PreviewPlant;
  index: number;
  conditionOptions: string[];
  availableLocations: { id: string; name: string }[];
  editedCondition?: string;
  editedTransferTo?: string;
  editedTransferFrom?: string;
  onConditionChange: (value: string) => void;
  onTransferToChange: (value: string | null) => void;
  onTransferFromChange: (value: string | null) => void;
}

function PlantRow({
  plant,
  index,
  conditionOptions,
  availableLocations,
  editedCondition,
  editedTransferTo,
  editedTransferFrom,
  onConditionChange,
  onTransferToChange,
  onTransferFromChange,
}: PlantRowProps) {
  const [showTransferEdit, setShowTransferEdit] = useState(false);
  const effectiveCondition = editedCondition || plant.detected_condition;
  const isEdited = !!editedCondition;

  // Resolve effective transfer names
  const effectiveTransferToId = editedTransferTo || plant.detected_transfer_to_id;
  const effectiveTransferFromId = editedTransferFrom || plant.detected_transfer_from_id;
  const effectiveTransferToName = editedTransferTo
    ? availableLocations.find((l) => l.id === editedTransferTo)?.name
    : plant.detected_transfer_to_name;
  const effectiveTransferFromName = editedTransferFrom
    ? availableLocations.find((l) => l.id === editedTransferFrom)?.name
    : plant.detected_transfer_from_name;

  const hasTransfer = effectiveTransferToName || effectiveTransferFromName;
  const hasTransferRaw = plant.transfer_from_raw || plant.transfer_to_raw;
  const isTransferEdited = !!editedTransferTo || !!editedTransferFrom;

  return (
    <TableRow className={`${isEdited || isTransferEdited ? 'bg-blue-50/50' : ''} ${plant.condition_confidence === 'low' ? 'bg-amber-50/30' : ''}`}>
      <TableCell className="text-xs text-muted-foreground">{index}</TableCell>
      <TableCell className="font-mono text-sm">
        <div className="flex items-center gap-1.5 flex-wrap">
          {plant.fleet_number}
          {plant.is_new && (
            <Badge variant="outline" className="text-[10px] bg-emerald-100 text-emerald-700 px-1 py-0">
              NEW
            </Badge>
          )}
        </div>
        {plant.is_new && plant.previous_location_name && (
          <span className="text-[10px] text-amber-600 block mt-0.5">
            from {plant.previous_location_name}
          </span>
        )}
      </TableCell>
      <TableCell className="text-sm text-muted-foreground truncate max-w-[200px]" title={plant.description || ''}>
        {plant.description || '-'}
      </TableCell>
      <TableCell className="text-right text-sm tabular-nums">{plant.hours_worked}</TableCell>
      <TableCell className="text-right text-sm tabular-nums">{plant.standby_hours}</TableCell>
      <TableCell className="text-right text-sm tabular-nums">{plant.breakdown_hours}</TableCell>
      <TableCell className="text-center">
        {plant.off_hire && (
          <Badge variant="outline" className="text-[10px] bg-slate-100 text-slate-700 px-1 py-0">
            Yes
          </Badge>
        )}
      </TableCell>
      <TableCell>
        <Select value={effectiveCondition} onValueChange={onConditionChange}>
          <SelectTrigger className={`h-7 text-xs ${isEdited ? 'ring-1 ring-blue-400' : ''}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {conditionOptions.map((c) => (
              <SelectItem key={c} value={c} className="text-xs">
                {CONDITION_LABELS[c] || c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell className="text-center">
        <ConfidenceDot confidence={plant.condition_confidence} reason={plant.condition_reason} />
      </TableCell>
      <TableCell className="text-xs">
        {showTransferEdit ? (
          <div className="space-y-1.5 min-w-[160px]">
            <div>
              <span className="text-[10px] text-muted-foreground">From:</span>
              <Select
                value={effectiveTransferFromId || '_none'}
                onValueChange={(v) => onTransferFromChange(v === '_none' ? null : v)}
              >
                <SelectTrigger className={`h-7 text-xs mt-0.5 ${isTransferEdited ? 'ring-1 ring-blue-400' : ''}`}>
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none" className="text-xs">None</SelectItem>
                  {availableLocations.map((loc) => (
                    <SelectItem key={loc.id} value={loc.id} className="text-xs">
                      {loc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <span className="text-[10px] text-muted-foreground">To:</span>
              <Select
                value={effectiveTransferToId || '_none'}
                onValueChange={(v) => onTransferToChange(v === '_none' ? null : v)}
              >
                <SelectTrigger className={`h-7 text-xs mt-0.5 ${isTransferEdited ? 'ring-1 ring-blue-400' : ''}`}>
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none" className="text-xs">None</SelectItem>
                  {availableLocations.map((loc) => (
                    <SelectItem key={loc.id} value={loc.id} className="text-xs">
                      {loc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <button
              className="text-[10px] text-muted-foreground hover:text-foreground underline"
              onClick={() => setShowTransferEdit(false)}
            >
              Done
            </button>
          </div>
        ) : (
          <div className="flex items-start gap-1">
            <div className="space-y-0.5 flex-1">
              {hasTransfer ? (
                <>
                  {effectiveTransferToName && (
                    <Badge variant="outline" className={`text-[10px] ${isTransferEdited ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'}`}>
                      &rarr; {effectiveTransferToName}
                    </Badge>
                  )}
                  {effectiveTransferFromName && (
                    <Badge variant="outline" className={`text-[10px] ${isTransferEdited ? 'bg-blue-50 text-blue-700' : 'bg-emerald-50 text-emerald-700'}`}>
                      &larr; {effectiveTransferFromName}
                    </Badge>
                  )}
                </>
              ) : hasTransferRaw ? (
                <div className="space-y-0.5">
                  {plant.transfer_to_raw && (
                    <span className="text-[10px] text-amber-600 block">&rarr; {plant.transfer_to_raw}</span>
                  )}
                  {plant.transfer_from_raw && (
                    <span className="text-[10px] text-emerald-600 block">&larr; {plant.transfer_from_raw}</span>
                  )}
                </div>
              ) : (
                <span className="text-muted-foreground">-</span>
              )}
            </div>
            <button
              className="text-muted-foreground hover:text-foreground p-0.5 shrink-0"
              onClick={() => setShowTransferEdit(true)}
              title="Edit transfer"
            >
              <Pencil className="h-3 w-3" />
            </button>
          </div>
        )}
      </TableCell>
      <TableCell className="text-xs text-muted-foreground truncate max-w-[180px]" title={plant.remarks || ''}>
        {plant.remarks || '-'}
      </TableCell>
    </TableRow>
  );
}

// ============================================================================
// Confidence Dot
// ============================================================================

function ConfidenceDot({ confidence, reason }: { confidence: string; reason: string }) {
  const colors: Record<string, string> = {
    high: 'bg-emerald-500',
    medium: 'bg-amber-500',
    low: 'bg-red-500',
  };

  return (
    <div className="flex items-center justify-center" title={reason}>
      <div className={`w-2.5 h-2.5 rounded-full ${colors[confidence] || 'bg-gray-400'}`} />
    </div>
  );
}

// ============================================================================
// Summary Card
// ============================================================================

function SummaryCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color?: string;
}) {
  const colorClass = color
    ? {
        emerald: 'text-emerald-600',
        purple: 'text-purple-600',
        green: 'text-emerald-600',
        amber: 'text-amber-600',
        red: 'text-red-600',
      }[color] || ''
    : '';

  return (
    <Card>
      <CardContent className="p-3">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`text-xl font-bold ${colorClass}`}>{value}</p>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Missing Plant Row
// ============================================================================

function MissingPlantRow({
  plant,
  action,
  availableLocations,
  onActionChange,
}: {
  plant: { fleet_number: string; description: string | null; last_condition: string | null };
  action?: MissingPlantAction;
  availableLocations: { id: string; name: string }[];
  onActionChange: (action: MissingPlantAction) => void;
}) {
  const currentAction = action?.action || 'keep';
  const showLocationSelect = currentAction === 'transferred';

  return (
    <TableRow>
      <TableCell className="font-mono text-sm">{plant.fleet_number}</TableCell>
      <TableCell className="text-sm text-muted-foreground">{plant.description || '-'}</TableCell>
      <TableCell>
        {plant.last_condition && (
          <Badge variant="outline" className={`text-xs ${CONDITION_COLORS[plant.last_condition] || ''}`}>
            {CONDITION_LABELS[plant.last_condition] || plant.last_condition}
          </Badge>
        )}
      </TableCell>
      <TableCell>
        <Select
          value={currentAction}
          onValueChange={(value) =>
            onActionChange({
              fleet_number: plant.fleet_number,
              action: value as MissingPlantAction['action'],
              transfer_to_location_id: value === 'transferred' ? action?.transfer_to_location_id : undefined,
            })
          }
        >
          <SelectTrigger className="h-7 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="keep" className="text-xs">Keep as-is</SelectItem>
            <SelectItem value="transferred" className="text-xs">Transferred</SelectItem>
            <SelectItem value="scrap" className="text-xs">Scrapped</SelectItem>
            <SelectItem value="missing" className="text-xs">Missing</SelectItem>
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell>
        {showLocationSelect && (
          <Select
            value={action?.transfer_to_location_id || ''}
            onValueChange={(value) =>
              onActionChange({
                fleet_number: plant.fleet_number,
                action: 'transferred',
                transfer_to_location_id: value,
              })
            }
          >
            <SelectTrigger className="h-7 text-xs">
              <SelectValue placeholder="Select site..." />
            </SelectTrigger>
            <SelectContent>
              {availableLocations.map((loc) => (
                <SelectItem key={loc.id} value={loc.id} className="text-xs">
                  {loc.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </TableCell>
    </TableRow>
  );
}

// ============================================================================
// Step 3: Success
// ============================================================================

function SuccessStep({
  submissionId,
  count,
  locationName,
  locationId,
  week,
  onUploadAnother,
}: {
  submissionId: string;
  count: number;
  locationName: string;
  locationId: string;
  week: { year: number; week_number: number };
  onUploadAnother: () => void;
}) {
  return (
    <Card>
      <CardContent className="p-8 text-center space-y-4">
        <CheckCircle2 className="h-16 w-16 text-emerald-500 mx-auto" />
        <h2 className="text-2xl font-bold">Report Saved Successfully</h2>
        <p className="text-muted-foreground">
          {count} plant records for <strong>Week {week.week_number}, {week.year}</strong> at{' '}
          <strong>{locationName}</strong> are being processed.
        </p>
        <p className="text-xs text-muted-foreground">
          Submission ID: {submissionId}
        </p>
        <div className="flex items-center justify-center gap-3 pt-4">
          <Button variant="outline" onClick={onUploadAnother}>
            Upload Another
          </Button>
          <Button asChild>
            <a href={`/locations/${locationId}`}>View Site</a>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Page Export
// ============================================================================

export default function UploadsPage() {
  return (
    <ProtectedRoute requiredRole="admin">
      <UploadPageContent />
    </ProtectedRoute>
  );
}
