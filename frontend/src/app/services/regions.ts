import api from './api';

export interface City { id:string; title:string; center_lat:number; center_lon:number; center:{lat:number;lon:number} }
export interface CityStats { city_id:string; city_title:string; regions:number; drivers:number; passengers:number; active_orders:number; total_orders:number }
export interface CreateCityData { id?:string; title:string; center_lat:number; center_lon:number }
export interface UpdateCityData { title?:string; center_lat?:number; center_lon?:number }
export interface Region { id:string; title:string; city:City; city_id?:string; center_lat:number; center_lon:number; center:{lat:number;lon:number}; polygon_coordinates?:number[][]; service_radius_meters?:number }
export interface RegionStats { region_id:string; region_title:string; drivers:number; passengers:number; active_orders:number; total_orders:number; can_delete?:boolean; needs_reassign?:{drivers?:number;passengers?:number} }
export interface DeleteRegionResult { deleted_region_id:string; deleted_region_title:string; reassigned_to?:string|null; reassigned_to_title?:string|null; drivers_reassigned?:number; passengers_reassigned?:number; orders_unlinked?:number }
export interface CreateRegionData { id?:string; title:string; city_id:string; center_lat:number; center_lon:number; polygon_coordinates?:number[][]; service_radius_meters?:number }
export interface UpdateRegionData { title?:string; city_id?:string; center_lat?:number; center_lon?:number; polygon_coordinates?:number[][]; service_radius_meters?:number }

const city:City={id:'atyrau',title:'Атырау',center_lat:47.0945,center_lon:51.9238,center:{lat:47.0945,lon:51.9238}};
const region:Region={id:'atyrau',title:'Атырау',city,city_id:city.id,center_lat:city.center_lat,center_lon:city.center_lon,center:city.center,service_radius_meters:30000};
const immutable=():never=>{throw new Error('Зона обслуживания задаётся конфигурацией сервера и не изменяется из панели');};
async function stats():Promise<RegionStats>{
  const [drivers,clients,orders]=await Promise.all([api.get<any[]>('/drivers',{params:{limit:200}}),api.get<any>('/clients/stats'),api.get<any[]>('/orders',{params:{limit:100}})]);
  return {region_id:region.id,region_title:region.title,drivers:drivers.data.length,passengers:clients.data.total,active_orders:orders.data.filter((o:any)=>!['completed','cancelled','exception'].includes(o.status)).length,total_orders:clients.data.total_orders,can_delete:false};
}
export const regionsApi={
  async getRegions():Promise<Region[]>{return [region];},
  async getRegion(id:string):Promise<Region>{if(id!==region.id)throw new Error('Регион не найден');return region;},
  async createRegion(_data:CreateRegionData):Promise<Region>{return immutable();},
  async updateRegion(_id:string,_data:UpdateRegionData):Promise<Region>{return immutable();},
  async deleteRegion(_id:string,_reassignTo?:string):Promise<DeleteRegionResult|void>{return immutable();},
  async getRegionStats(_id:string):Promise<RegionStats>{return stats();},
  async getCities():Promise<City[]>{return [city];},
  async getCity(id:string):Promise<City>{if(id!==city.id)throw new Error('Город не найден');return city;},
  async createCity(_data:CreateCityData):Promise<City>{return immutable();},
  async updateCity(_id:string,_data:UpdateCityData):Promise<City>{return immutable();},
  async deleteCity(_id:string):Promise<void>{return immutable();},
  async getCityStats(_id:string):Promise<CityStats>{const s=await stats();return {city_id:city.id,city_title:city.title,regions:1,drivers:s.drivers,passengers:s.passengers,active_orders:s.active_orders,total_orders:s.total_orders};},
};
