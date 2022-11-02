const os = require('os')
const path = require('path')

module.exports = {
	SHELLDIR: path.join(os.homedir(), '.hypershell')
}
