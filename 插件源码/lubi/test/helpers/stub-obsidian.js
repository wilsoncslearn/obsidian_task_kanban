export class TFile {} ; export class TFolder {}; export class App {}
export class Notice { constructor() {} }
export const normalizePath = (p) => p.replace(/\\/g,'/').replace(/\/+/g,'/').replace(/^\/|\/$/g,'');
export class Menu { addItem() { return this; } showAtMouseEvent() { return this; } }
