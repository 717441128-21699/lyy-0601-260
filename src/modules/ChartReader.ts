import { ChartData, Note, NoteType } from '../types';

export class ChartReader {
  private chart: ChartData | null = null;
  private sortedNotes: Note[] = [];

  loadChart(data: ChartData): void {
    const cloned: ChartData = JSON.parse(JSON.stringify(data));
    this.chart = cloned;
    this.sortedNotes = [...cloned.notes].sort((a, b) => a.time - b.time);
    this.validateChart();
  }

  loadChartFromJSON(jsonString: string): void {
    const data = JSON.parse(jsonString) as ChartData;
    this.loadChart(data);
  }

  getChart(): ChartData | null {
    return this.chart;
  }

  getNotes(): Note[] {
    return this.sortedNotes;
  }

  getNoteById(id: string): Note | undefined {
    return this.sortedNotes.find(n => n.id === id);
  }

  getNotesInTimeRange(startTime: number, endTime: number): Note[] {
    return this.sortedNotes.filter(
      note => note.time >= startTime && note.time <= endTime
    );
  }

  getUpcomingNotes(currentTime: number, windowMs: number = 2000): Note[] {
    return this.sortedNotes.filter(
      note => note.time >= currentTime && note.time <= currentTime + windowMs
    );
  }

  getNotesByTrack(track: number): Note[] {
    return this.sortedNotes.filter(note => note.track === track);
  }

  getNotesByType(type: NoteType): Note[] {
    return this.sortedNotes.filter(note => note.type === type);
  }

  getTotalNoteCount(): number {
    return this.sortedNotes.length;
  }

  getDuration(): number {
    if (this.sortedNotes.length === 0) return 0;
    const lastNote = this.sortedNotes[this.sortedNotes.length - 1];
    const endTime = lastNote.endTime || lastNote.time;
    return Math.max(endTime, this.chart?.duration || 0);
  }

  getBpmAtTime(time: number): number {
    return this.chart?.bpm || 120;
  }

  getOffset(): number {
    return this.chart?.offset || 0;
  }

  private validateChart(): void {
    if (!this.chart) {
      throw new Error('Chart data is null');
    }
    if (!this.chart.title) {
      console.warn('Chart title is missing');
    }
    if (this.chart.bpm <= 0) {
      throw new Error('Invalid BPM value');
    }
    if (this.sortedNotes.length === 0) {
      console.warn('Chart has no notes');
    }
    const idSet = new Set<string>();
    for (const note of this.sortedNotes) {
      if (idSet.has(note.id)) {
        throw new Error(`Duplicate note id: ${note.id}`);
      }
      idSet.add(note.id);
      if (note.type === NoteType.HOLD) {
        if (!note.endTime || note.endTime <= note.time) {
          throw new Error(`Invalid HOLD note: ${note.id}, endTime missing or invalid`);
        }
      }
      if (note.type === NoteType.SLIDE) {
        if (!note.endTime || note.endTime <= note.time) {
          throw new Error(`Invalid SLIDE note: ${note.id}, endTime missing or invalid`);
        }
      }
    }
  }

  exportToJSON(): string {
    if (!this.chart) {
      throw new Error('No chart loaded');
    }
    return JSON.stringify(this.chart, null, 2);
  }
}
