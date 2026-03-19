// utils/helpers.js
exports.maskName = (name) => {
    if (!name) return 'khach_an_danh';
    if (name.length <= 4) return name.substring(0, 1) + '***';
    return name.substring(0, 3) + '***';
};