"""English upload errors; source attribute names and values are never translated."""
import re
def english_upload_error(detail):
 if not isinstance(detail,str):return detail
 exact={
 '单次上传最大256 MiB。':'Each upload must be at most 256 MiB.',
 'ZIP解压后超过512 MiB或文件数量超过512。':'The ZIP exceeds 512 MiB expanded or contains more than 512 files.',
 '请用ZIP保留目录结构。':'Use ZIP to preserve the folder structure.',
 'ZIP请单独上传。':'Upload one ZIP by itself.',
 '首版单次支持最多100,000个要素，请分区域上传。':'Upload at most 100,000 features at a time; split larger datasets by area.',
 '影像没有可识别的坐标系，请上传GeoTIFF或完整世界文件与.prj。':'No CRS found. Upload a GeoTIFF or include a world file and .prj.',
 '影像缺少地理定位信息，不能按普通图片直接放到地图。':'The image is not georeferenced and cannot be positioned on the map.',
 '未能识别坐标系，请补充正确的.prj。':'The CRS could not be identified. Include the correct .prj file.',
 '文件包含空或无效几何，请在副本中修复后再上传。':'Empty or invalid geometries found. Repair a copy before uploading.',
 '坐标范围无效或超出地图可显示范围，请检查坐标系。':'Invalid or unsupported coordinate extent. Check the CRS.',
 '属性编码包含替换字符，请选择正确编码后重试。':'Text contains replacement characters. Choose the correct encoding.',
 '未找到.shp主文件。':'No .shp file found.',
 '每次上传一个Shapefile图层。':'Upload one Shapefile layer at a time.',
 '请选择一个GeoTIFF影像或包含完整栅格数据集的ZIP。':'Choose one GeoTIFF or a ZIP containing a complete raster dataset.',
 '请将矢量和卫星影像分开上传。':'Upload vector layers and imagery separately.'}
 if detail in exact:return exact[detail]
 for zh,en in {'Shapefile缺少配套文件：':'Missing Shapefile companions: ','不支持该文件类型：':'Unsupported file type: ','ZIP包含不支持的文件：':'Unsupported file in ZIP: '}.items():
  if detail.startswith(zh):return en+detail[len(zh):]
 return 'Unable to import this dataset. Check companion files, encoding, geometry and CRS.' if re.search(r'[\u4e00-\u9fff]',detail) else detail
