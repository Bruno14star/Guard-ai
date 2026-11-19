// ADMIN ONLY SEED LIST — NEVER EXPOSED ON USER SCREENS
export interface PoliceSeedEntry {
  state: string;
  area: string;
  stationName: string;
  phone1: string;
  phone2: string;
  isVerified: boolean;
  isActive: boolean;
}

export const NIGERIA_POLICE_SEED: PoliceSeedEntry[] = [
  { state: 'Abia', area: 'Umuahia HQ', stationName: 'Abia State Police Command', phone1: '08035415408', phone2: '08079210003', isVerified: false, isActive: true },
  { state: 'Adamawa', area: 'Yola HQ', stationName: 'Adamawa State Police Command', phone1: '08089671313', phone2: '08065604764', isVerified: false, isActive: true },
  { state: 'Akwa Ibom', area: 'Uyo HQ', stationName: 'Akwa Ibom State Police Command', phone1: '08039213071', phone2: '08020913810', isVerified: false, isActive: true },
  { state: 'Anambra', area: 'Awka HQ', stationName: 'Anambra State Police Command', phone1: '07039194332', phone2: '08024922772', isVerified: false, isActive: true },
  { state: 'Bauchi', area: 'Bauchi HQ', stationName: 'Bauchi State Police Command', phone1: '08151849417', phone2: '08127162434', isVerified: false, isActive: true },
  { state: 'Bayelsa', area: 'Yenagoa HQ', stationName: 'Bayelsa State Police Command', phone1: '07034578208', phone2: '07032702984', isVerified: false, isActive: true },
  { state: 'Benue', area: 'Makurdi HQ', stationName: 'Benue State Police Command', phone1: '08066006475', phone2: '08053039936', isVerified: false, isActive: true },
  { state: 'Borno', area: 'Maiduguri HQ', stationName: 'Borno State Police Command', phone1: '08068075581', phone2: '08036071667', isVerified: false, isActive: true },
  { state: 'Cross River', area: 'Calabar HQ', stationName: 'Cross River State Police Command', phone1: '08133568456', phone2: '07053355415', isVerified: false, isActive: true },
  { state: 'Delta', area: 'Asaba HQ', stationName: 'Delta State Police Command', phone1: '08036684974', phone2: '08037058988', isVerified: false, isActive: true },
  { state: 'Ebonyi', area: 'Abakaliki HQ', stationName: 'Ebonyi State Police Command', phone1: '07064515001', phone2: '08125273721', isVerified: false, isActive: true },
  { state: 'Edo', area: 'Benin City HQ', stationName: 'Edo State Police Command', phone1: '08037646272', phone2: '08077773721', isVerified: false, isActive: true },
  { state: 'Ekiti', area: 'Ado-Ekiti HQ', stationName: 'Ekiti State Police Command', phone1: '08062335577', phone2: '07089310359', isVerified: false, isActive: true },
  { state: 'Enugu', area: 'Enugu HQ', stationName: 'Enugu State Police Command', phone1: '08032003702', phone2: '08075390883', isVerified: false, isActive: true },
  { state: 'FCT Abuja', area: 'Garki HQ', stationName: 'FCT Abuja Police Command', phone1: '07057337653', phone2: '08061581938', isVerified: false, isActive: true },
  { state: 'Gombe', area: 'Gombe HQ', stationName: 'Gombe State Police Command', phone1: '08150567771', phone2: '08151855014', isVerified: false, isActive: true },
  { state: 'Imo', area: 'Owerri HQ', stationName: 'Imo State Police Command', phone1: '08034773600', phone2: '08037037283', isVerified: false, isActive: true },
  { state: 'Jigawa', area: 'Dutse HQ', stationName: 'Jigawa State Police Command', phone1: '08075391069', phone2: '07089846285', isVerified: false, isActive: true },
  { state: 'Kaduna', area: 'Kaduna HQ', stationName: 'Kaduna State Police Command', phone1: '08123822284', phone2: '08166405566', isVerified: false, isActive: true },
  { state: 'Kano', area: 'Kano HQ', stationName: 'Kano State Police Command', phone1: '08032419754', phone2: '08123821575', isVerified: false, isActive: true },
  { state: 'Katsina', area: 'Katsina HQ', stationName: 'Katsina State Police Command', phone1: '08075391255', phone2: '08075391250', isVerified: false, isActive: true },
  { state: 'Kebbi', area: 'Birnin Kebbi HQ', stationName: 'Kebbi State Police Command', phone1: '08038797644', phone2: '08075391307', isVerified: false, isActive: true },
  { state: 'Kogi', area: 'Lokoja HQ', stationName: 'Kogi State Police Command', phone1: '07038329084', phone2: '08152195982', isVerified: false, isActive: true },
  { state: 'Kwara', area: 'Ilorin HQ', stationName: 'Kwara State Police Command', phone1: '07032069501', phone2: '08125275046', isVerified: false, isActive: true },
  { state: 'Lagos', area: 'Ikeja HQ', stationName: 'Lagos State Police Command', phone1: '08063299264', phone2: '08065154338', isVerified: false, isActive: true },
  { state: 'Nasarawa', area: 'Lafia HQ', stationName: 'Nasarawa State Police Command', phone1: '08123821571', phone2: '07075391560', isVerified: false, isActive: true },
  { state: 'Niger', area: 'Minna HQ', stationName: 'Niger State Police Command', phone1: '08081777498', phone2: '08127185198', isVerified: false, isActive: true },
  { state: 'Ogun', area: 'Abeokuta HQ', stationName: 'Ogun State Police Command', phone1: '08032136765', phone2: '08081770416', isVerified: false, isActive: true },
  { state: 'Ondo', area: 'Akure HQ', stationName: 'Ondo State Police Command', phone1: '07034313903', phone2: '08075391808', isVerified: false, isActive: true },
  { state: 'Osun', area: 'Osogbo HQ', stationName: 'Osun State Police Command', phone1: '08075872433', phone2: '08039537995', isVerified: false, isActive: true },
  { state: 'Oyo', area: 'Ibadan HQ', stationName: 'Oyo State Police Command', phone1: '08081768614', phone2: '08150777888', isVerified: false, isActive: true },
  { state: 'Plateau', area: 'Jos HQ', stationName: 'Plateau State Police Command', phone1: '08126375938', phone2: '08075391844', isVerified: false, isActive: true },
  { state: 'Rivers', area: 'Port Harcourt HQ', stationName: 'Rivers State Police Command', phone1: '08032003514', phone2: '08073777717', isVerified: false, isActive: true },
  { state: 'Sokoto', area: 'Sokoto HQ', stationName: 'Sokoto State Police Command', phone1: '07068848035', phone2: '08075391943', isVerified: false, isActive: true },
  { state: 'Taraba', area: 'Jalingo HQ', stationName: 'Taraba State Police Command', phone1: '08140089863', phone2: '08073260267', isVerified: false, isActive: true },
  { state: 'Yobe', area: 'Damaturu HQ', stationName: 'Yobe State Police Command', phone1: '07039301585', phone2: '08035067570', isVerified: false, isActive: true },
  { state: 'Zamfara', area: 'Gusau HQ', stationName: 'Zamfara State Police Command', phone1: '08106580123', phone2: '07046444093', isVerified: false, isActive: true },
];

export const NIGERIAN_STATES = NIGERIA_POLICE_SEED.map((s) => s.state);
