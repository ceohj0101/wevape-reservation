// Mock replacement for chart.js CDN — just enough surface area so drawBarChart/drawPieChart don't throw.
window.Chart = class {
  constructor(){ this.destroyed = false; }
  destroy(){ this.destroyed = true; }
};

// ---- Mock in-memory "Supabase" client -------------------------------------------------
(function(){
  let nextId = 1;
  const now = () => new Date('2026-08-08T09:00:00Z').toISOString();

  const db = {
    resv_stores: [
      { id: 1, name: '본점', active: true, sort_order: 1 },
      { id: 2, name: '로데오점', active: true, sort_order: 2 },
    ],
    resv_staff: [
      { id: 1, name: '실장님', pin: '0000', role: 'manager', store_id: null, active: true },
      { id: 2, name: '신재현', pin: '0000', role: 'staff', store_id: null, active: true },
    ],
    resv_reason_options: [
      { id: 1, type: 'as', label: '작동불량', active: true, sort_order: 1 },
      { id: 2, type: 'product_request', label: '단종', active: true, sort_order: 1 },
    ],
    resv_product_requests: [],
    resv_as_requests: [],
  };

  function clone(x){ return JSON.parse(JSON.stringify(x)); }

  function applyFilters(rows, filters){
    return rows.filter(row => filters.every(f => {
      if(f.op === 'eq') return String(row[f.col]) === String(f.val);
      if(f.op === 'gte') return row[f.col] >= f.val;
      if(f.op === 'lt') return row[f.col] < f.val;
      return true;
    }));
  }

  class QueryBuilder {
    constructor(table, mode){
      this.table = table;
      this.mode = mode; // 'select' | 'insert' | 'update'
      this.filters = [];
      this._orders = [];
      this._payload = null;
    }
    select(){ return this; }
    eq(col, val){ this.filters.push({op:'eq', col, val}); return this; }
    gte(col, val){ this.filters.push({op:'gte', col, val}); return this; }
    lt(col, val){ this.filters.push({op:'lt', col, val}); return this; }
    order(col, opts){ this._orders.push({ col, asc: !(opts && opts.ascending===false), nullsFirst: opts && opts.nullsFirst }); return this; }
    then(resolve, reject){
      try{
        let rows;
        if(this.mode === 'insert'){
          const rec = Object.assign({ id: nextId++, created_at: now(), updated_at: now() }, this._payload);
          db[this.table].push(rec);
          resolve({ data: [rec], error: null });
          return;
        }
        if(this.mode === 'update'){
          const targets = applyFilters(db[this.table], this.filters);
          targets.forEach(t => Object.assign(t, this._payload, { updated_at: now() }));
          resolve({ data: clone(targets), error: null });
          return;
        }
        rows = clone(applyFilters(db[this.table], this.filters));
        if(this._orders.length){
          rows.sort((a,b)=>{
            for(const o of this._orders){
              const av = a[o.col], bv = b[o.col];
              if(av == null && bv == null) continue;
              if(av == null) return o.nullsFirst===false ? 1 : -1;
              if(bv == null) return o.nullsFirst===false ? -1 : 1;
              if(av > bv) return o.asc ? 1 : -1;
              if(av < bv) return o.asc ? -1 : 1;
            }
            return 0;
          });
        }
        resolve({ data: rows, error: null });
      }catch(e){ resolve({ data:null, error:{message: e.message} }); }
    }
  }

  class Insertable extends QueryBuilder {
    constructor(table, payload){ super(table, 'insert'); this._payload = payload; }
  }
  class Updatable extends QueryBuilder {
    constructor(table, payload){ super(table, 'update'); this._payload = payload; }
  }

  const client = {
    from(table){
      return {
        select(){ const q = new QueryBuilder(table, 'select'); return q; },
        insert(payload){ return new Insertable(table, payload); },
        update(payload){ return new Updatable(table, payload); },
      };
    },
    rpc(name, args){
      return new Promise(resolve=>{
        if(name === 'resv_login'){
          const staff = db.resv_staff.find(s=>s.id===args.p_staff_id && s.pin===args.p_pin);
          resolve({ data: staff ? [{ id: staff.id, name: staff.name, role: staff.role, store_id: staff.store_id }] : [], error: null });
        } else {
          resolve({ data: null, error: { message: 'unknown rpc' } });
        }
      });
    },
    storage: {
      from(){
        return {
          upload(path){ return Promise.resolve({ data: { path }, error: null }); },
          getPublicUrl(path){ return { data: { publicUrl: 'https://mock.local/'+path } }; },
        };
      }
    }
  };

  // resv_staff_public used by login screen — same as resv_staff minus pin.
  client.from = (function(orig){
    return function(table){
      if(table === 'resv_staff_public'){
        return {
          select(){
            const q = new QueryBuilder('resv_staff', 'select');
            const origThen = q.then.bind(q);
            q.then = (resolve)=> origThen((res)=>{
              resolve({ data: res.data.map(s=>({id:s.id, name:s.name, role:s.role, store_id:s.store_id})), error: null });
            });
            return q;
          }
        };
      }
      return orig(table);
    };
  })(client.from);

  window.__mockDb = db;
  window.supabase = { createClient: () => client };
})();
