import api from './api';

export interface City { id:string; title:string; center_lat:number; center_lon:number; center:{lat:number;lon:number} }
export interface Region { id:string; title:string; city:City; city_id?:string; center_lat:number; center_lon:number; center:{lat:number;lon:number}; polygon_coordinates?:number[][]; service_radius_meters?:number }
export interface RegionStats { region_id:string; region_title:string; drivers:number; passengers:number; active_orders:number; total_orders:number }

const city:City={id:'atyrau',title:'Атырау',center_lat:47.0945,center_lon:51.9238,center:{lat:47.0945,lon:51.9238}};
const region:Region={id:'atyrau',title:'Атырау',city,city_id:city.id,center_lat:city.center_lat,center_lon:city.center_lon,center:city.center,service_radius_meters:30000};
async function stats():Promise<RegionStats>{
  const [drivers,clients,orders]=await Promise.all([api.get<any[]>('/drivers',{params:{limit:200}}),api.get<any>('/clients/stats'),api.get<any[]>('/orders',{params:{limit:100}})]);
  return {region_id:region.id,region_title:region.title,drivers:drivers.data.length,passengers:clients.data.total,active_orders:orders.data.filter((o:any)=>!['completed','cancelled','exception'].includes(o.status)).length,total_orders:clients.data.total_orders};
}
export const regionsApi={
  async getRegions():Promise<Region[]>{return [region];},
  async getRegion(id:string):Promise<Region>{if(id!==region.id)throw new Error('Регион не найден');return region;},
  async getRegionStats(_id:string):Promise<RegionStats>{return stats();},
  async getCities():Promise<City[]>{return [city];},
  async getCity(id:string):Promise<City>{if(id!==city.id)throw new Error('Город не найден');return city;},
};
