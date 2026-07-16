import api from './api';

export interface AnalyticsParams { date_from?: string; date_to?: string; region_id?: string | number; driver_id?: number; granularity?: 'hour'|'day'|'week'|'month'; limit?: number }
export interface Metrics {
  total_orders: number; completed_orders: number; cancelled_orders: number; success_rate: number;
  avg_duration_minutes: number|null; avg_distance_km: number|null; avg_assignment_time_minutes: number|null;
  status_distribution: Array<{status:string;count:number}>;
  disability_distribution: Array<{passenger__disability_category:string;count:number}>;
  orders_with_surge:number; avg_surge_multiplier:number; online_drivers:number; active_drivers:number;
  avg_rating:number; total_revenue:number; avg_order_value:number; avg_quote:number; avg_final_price:number;
  completed_orders_count:number;
}
export interface FinancialMetrics { total_revenue:number; avg_order_value:number; avg_quote:number; avg_final_price:number; completed_orders_count:number }
export interface DriverMetrics { online_drivers:number; active_drivers:number; avg_rating:number }
export interface TimeSeriesData { period:string; total:number; completed:number; cancelled:number; revenue:number }
export interface RegionDistribution { region_id:string; region_title:string; orders_count:number; completed_count:number; revenue:number }
export interface PeakHours { hour:string; orders:number }
export interface DriverPerformance { driver_id:number; driver_name:string; rating:number; orders:number; revenue:number; total_offers:number; accepted_offers:number; declined_offers:number; acceptance_rate:number }
export interface ComparisonMetrics { current:{orders:number;completed:number;revenue:number;avg_order_value:number}; previous:{orders:number;completed:number;revenue:number;avg_order_value:number}; changes:{orders:number;completed:number;revenue:number;avg_order_value:number} }

interface RawOrder { id:string; service_date:string; desired_time:string; status:string; created_at:string }
interface RawDriver { user_id:string; full_name:string; is_online:boolean }

const ordersCache = new Map<string, { expiresAt: number; promise: Promise<RawOrder[]> }>();
let driversCache: { expiresAt: number; promise: Promise<RawDriver[]> } | null = null;

function normalizedDate(value?: string): string | undefined {
  return value?.slice(0, 10) || undefined;
}

async function allOrders(params?: AnalyticsParams): Promise<RawOrder[]> {
  const from = normalizedDate(params?.date_from);
  const to = normalizedDate(params?.date_to);
  const key = `${from ?? ''}:${to ?? ''}`;
  const cached = ordersCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;
  const promise = (async () => {
    const rows: RawOrder[] = [];
    for (let offset = 0; offset < 5000; offset += 100) {
      const page = (await api.get<RawOrder[]>('/orders', {
        params: { limit: 100, offset, service_date_from: from, service_date_to: to },
      })).data;
      rows.push(...page);
      if (page.length < 100) break;
    }
    return rows.filter((o) => (!from || o.service_date >= from) && (!to || o.service_date <= to));
  })();
  ordersCache.set(key, { expiresAt: Date.now() + 5_000, promise });
  try {
    return await promise;
  } catch (error) {
    ordersCache.delete(key);
    throw error;
  }
}
async function drivers(): Promise<RawDriver[]> {
  if (driversCache && driversCache.expiresAt > Date.now()) return driversCache.promise;
  const promise = api.get<RawDriver[]>('/drivers', { params: { limit: 200 } }).then(({ data }) => data);
  driversCache = { expiresAt: Date.now() + 5_000, promise };
  try {
    return await promise;
  } catch (error) {
    driversCache = null;
    throw error;
  }
}
const done = (s:string) => s === 'completed';
const cancelled = (s:string) => s === 'cancelled';

function baseMetrics(orders: RawOrder[], driverRows: RawDriver[]): Metrics {
  const byStatus = new Map<string, number>();
  orders.forEach((o) => byStatus.set(o.status, (byStatus.get(o.status) || 0) + 1));
  const completed = orders.filter((o) => done(o.status)).length;
  const cancelledCount = orders.filter((o) => cancelled(o.status)).length;
  const online = driverRows.filter((d) => d.is_online).length;
  return {
    total_orders: orders.length, completed_orders: completed, cancelled_orders: cancelledCount,
    success_rate: orders.length ? completed / orders.length * 100 : 0,
    avg_duration_minutes: null, avg_distance_km: null, avg_assignment_time_minutes: null,
    status_distribution: [...byStatus].map(([status,count]) => ({status,count})), disability_distribution: [],
    orders_with_surge: 0, avg_surge_multiplier: 1, online_drivers: online, active_drivers: online,
    avg_rating: 0, total_revenue: 0, avg_order_value: 0, avg_quote: 0, avg_final_price: 0,
    completed_orders_count: completed,
  };
}
const pct = (current:number, previous:number) => previous ? (current - previous) / previous * 100 : (current ? 100 : 0);

export const analyticsApi = {
  async getMetrics(params?: AnalyticsParams): Promise<Metrics> { return baseMetrics(await allOrders(params), await drivers()); },
  async getOrdersAnalytics(params?: AnalyticsParams): Promise<Metrics> { return this.getMetrics(params); },
  async getFinancialAnalytics(params?: AnalyticsParams): Promise<FinancialMetrics> {
    const m = await this.getMetrics(params); return { total_revenue:0, avg_order_value:0, avg_quote:0, avg_final_price:0, completed_orders_count:m.completed_orders };
  },
  async getDriversAnalytics(): Promise<DriverMetrics> { const d=await drivers(); const n=d.filter(x=>x.is_online).length; return {online_drivers:n,active_drivers:n,avg_rating:0}; },
  async getTimeSeries(params?: AnalyticsParams): Promise<TimeSeriesData[]> {
    const rows=await allOrders(params); const groups=new Map<string,RawOrder[]>();
    rows.forEach(o=>groups.set(o.service_date,[...(groups.get(o.service_date)||[]),o]));
    return [...groups].sort(([a],[b])=>a.localeCompare(b)).map(([period,items])=>({period,total:items.length,completed:items.filter(o=>done(o.status)).length,cancelled:items.filter(o=>cancelled(o.status)).length,revenue:0}));
  },
  async getRegionDistribution(params?: AnalyticsParams): Promise<RegionDistribution[]> {
    const rows=await allOrders(params); return [{region_id:'atyrau',region_title:'Атырау',orders_count:rows.length,completed_count:rows.filter(o=>done(o.status)).length,revenue:0}];
  },
  async getPeakHours(params?: AnalyticsParams): Promise<PeakHours[]> {
    const rows=await allOrders(params); const hours=Array.from({length:24},(_,h)=>({hour:`${String(h).padStart(2,'0')}:00`,orders:0}));
    rows.forEach(o=>{ const h=Number(String(o.desired_time).slice(0,2)); if(Number.isInteger(h)&&hours[h]) hours[h].orders++; }); return hours;
  },
  async getDriverPerformance(params?: AnalyticsParams): Promise<DriverPerformance[]> {
    const rows=await drivers(); return rows.slice(0,params?.limit||rows.length).map((d,i)=>({driver_id:i,driver_name:d.full_name,rating:0,orders:0,revenue:0,total_offers:0,accepted_offers:0,declined_offers:0,acceptance_rate:0}));
  },
  async exportReport(type:'orders'|'financial'|'drivers', params?:AnalyticsParams): Promise<Blob> {
    const rows=await allOrders(params); const csv=`\uFEFFtype,id,date,time,status\n${rows.map(o=>`${type},${o.id},${o.service_date},${o.desired_time},${o.status}`).join('\n')}`; return new Blob([csv],{type:'text/csv;charset=utf-8'});
  },
  async getComparison(params?:AnalyticsParams): Promise<ComparisonMetrics> {
    const currentRows=await allOrders(params); let previousRows:RawOrder[]=[];
    if(params?.date_from&&params.date_to){ const from=new Date(`${normalizedDate(params.date_from)}T00:00:00Z`); const to=new Date(`${normalizedDate(params.date_to)}T00:00:00Z`); const days=Math.max(1,Math.round((to.getTime()-from.getTime())/86400000)+1); const prevTo=new Date(from.getTime()-86400000); const prevFrom=new Date(prevTo.getTime()-(days-1)*86400000); previousRows=await allOrders({date_from:prevFrom.toISOString().slice(0,10),date_to:prevTo.toISOString().slice(0,10)}); }
    const current={orders:currentRows.length,completed:currentRows.filter(o=>done(o.status)).length,revenue:0,avg_order_value:0}; const previous={orders:previousRows.length,completed:previousRows.filter(o=>done(o.status)).length,revenue:0,avg_order_value:0};
    return {current,previous,changes:{orders:pct(current.orders,previous.orders),completed:pct(current.completed,previous.completed),revenue:0,avg_order_value:0}};
  },
};
